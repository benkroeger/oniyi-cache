'use strict';

// node core modules
const assert = require('assert');
const util = require('util');
const debug = require('debug');

// 3rd party modules
const _ = require('lodash');
const redis = require('redis');
const crypto = require('crypto');

// internal modules
const Evaluator = require('./evaluator');

// variables and functions

const includeRequestPropertiesInHash = ['uri', 'qs', 'method', 'authenticatedUser'];

const excludeRequestHeadersFromHash = ['cookie', 'authorization'];

const validHostConfigProperties = [
  'storePrivate',
  'storeNoStore',
  'ignoreNoLastMod',
  'requestValidators',
  'responseValidators',
];

const mergeableEvaluatorConfigProperties = ['storePrivate', 'storeNoStore', 'ignoreNoLastMod'];

const serializableResponseProperties = [
  // 'headers', // --> headers are treated explicitly when serializing the response object
  'trailers',
  'statusCode',
  'httpVersion',
  'httpVersionMajor',
  'httpVersionMinor',
];

function serializeResponseObject(responseObject) {
  return JSON.stringify(
    _.merge(_.pick(responseObject, serializableResponseProperties), {
      headers: _.omit(responseObject.headers, [
        'set-cookie',
        'date',
        'transfer-encoding',
        'if-none-match',
        'if-modified-since',
      ]),
      fromCache: true,
    })
  );
}

function OniyiCache(args) {
  const self = this;

  // check pre-requisites
  assert(_.isPlainObject(args), 'args must be provided as plain object');

  self.keyPrefix = 'oniyi-cache:';
  // extract global validator options
  self.globalConfig = _.merge(
    {
      storePrivate: false,
      storeNoStore: false,
      ignoreNoLastMod: false,
      requestValidators: [],
      responseValidators: [],
    },
    _.pick(args, validHostConfigProperties)
  );

  // extract the validator options per hostname from provided "hostConfig" object
  self.hostConfig = {};
  if (_.isPlainObject(args.hostConfig)) {
    self.hostConfig = _.reduce(
      args.hostConfig,
      (result, conf, hostname) => {
        Object.assign(result, {
          [hostname]: _.pick(conf, validHostConfigProperties),
        });

        return result;
      },
      self.hostConfig
    );
  }

  self.includeRequestPropertiesInHash = _.union(
    includeRequestPropertiesInHash,
    _.isArray(args.includeRequestPropertiesInHash) ? args.includeRequestPropertiesInHash : []
  );
  self.excludeRequestHeadersFromHash = _.union(
    excludeRequestHeadersFromHash,
    _.isArray(args.excludeRequestHeadersFromHash) ? args.excludeRequestHeadersFromHash : []
  );

  if (args.redisClient) {
    self.redisClient = args.redisClient;
    return self;
  }

  assert(
    _.isPlainObject(args.redis),
    'args.redis must be provided as plain object if no args.redisClient is available'
  );
  const redisOptions = args.redis;
  // make unixSocket superseed host and port information
  if (redisOptions.unixSocket) {
    debug('creating redis client for unix socket');
    self.redisClient = redis.createClient(redisOptions.unixSocket, redisOptions);

    return self;
  }

  debug('creating redis client for host "%s" and port "%d"', redisOptions.host, redisOptions.port);
  self.redisClient = redis.createClient(redisOptions.port, redisOptions.host, redisOptions);

  return self;
}

// prototype definitions
OniyiCache.prototype.makeHash = function makeHash(requestObject) {
  const self = this;

  const data = JSON.stringify(
    _.merge(_.pick(requestObject, self.includeRequestPropertiesInHash), {
      headers: _.omit(requestObject.headers, self.excludeRequestHeadersFromHash),
    })
  );

  return crypto
    .createHash('md5')
    .update(data)
    .digest('hex');
};

OniyiCache.prototype.addHostConfigs = function addHostConfigs(config) {
  const self = this;

  _.forOwn(config, (hostConfig, hostname) => {
    if (_.isUndefined(self.hostConfig[hostname])) {
      self.hostConfig[hostname] = _.pick(hostConfig, validHostConfigProperties);
    }
  });
};

OniyiCache.prototype.setHostConfigs = function setHostConfigs(config) {
  const self = this;

  _.forOwn(config, (hostConfig, hostname) => {
    self.hostConfig[hostname] = _.pick(hostConfig, validHostConfigProperties);
  });
};

OniyiCache.prototype.updateHostConfigs = function updateHostConfigs(config) {
  const self = this;

  _.forOwn(config, (hostConfig, hostname) => {
    self.hostConfig[hostname] = _.merge(self.hostConfig[hostname] || {}, _.pick(hostConfig, validHostConfigProperties));
  });
};

OniyiCache.prototype.clearHostConfigs = function clearHostConfigs(hostnamesArray) {
  if (!_.isArray(hostnamesArray)) {
    return;
  }
  const self = this;
  hostnamesArray.forEach((hostname) => {
    self.hostConfig[hostname] = {};
  });
};

OniyiCache.prototype.getEvaluator = function getEvaluator(hostname, config) {
  const self = this;
  let hostConfig = {};

  /* eslint-disable no-param-reassign */
  // if first argument is plain object, take that as "config" and ignore hostname
  if (_.isPlainObject(hostname)) {
    config = hostname;
    hostname = null;
  }

  // make sure config is defined and has the right format
  if (!_.isPlainObject(config)) {
    config = {};
  }
  /* eslint-enable no-param-reassign */

  // if hostname was provided and we have a valid config object for this hostname, load that config.
  if (_.isString(hostname) && _.isPlainObject(self.hostConfig[hostname])) {
    hostConfig = self.hostConfig[hostname];
  }

  // merge global cache settings with the specific ones for this hostname (if available) and the provided config options
  const cacheSettings = _.merge(
    {},
    self.globalConfig,
    _.pick(hostConfig, mergeableEvaluatorConfigProperties),
    _.pick(config, mergeableEvaluatorConfigProperties)
  );

  if (!_.isArray(cacheSettings.requestValidators)) {
    cacheSettings.requestValidators = [];
  }
  if (!_.isArray(cacheSettings.responseValidators)) {
    cacheSettings.responseValidators = [];
  }

  // concatenate requestValidators (config first, then hostname, then global)
  // the more narrow the scope, the higher the priority
  if (_.isArray(hostConfig.requestValidators)) {
    cacheSettings.requestValidators = hostConfig.requestValidators.concat(cacheSettings.requestValidators);
  }
  if (_.isArray(config.requestValidators)) {
    cacheSettings.requestValidators = config.requestValidators.concat(cacheSettings.requestValidators);
  }

  // concatenate responseValidators (config first, then hostname, then global)
  // the more narrow the scope, the higher the priority
  if (_.isArray(hostConfig.responseValidators)) {
    cacheSettings.responseValidators = hostConfig.responseValidators.concat(cacheSettings.responseValidators);
  }
  if (_.isArray(config.responseValidators)) {
    cacheSettings.responseValidators = config.responseValidators.concat(cacheSettings.responseValidators);
  }

  return new Evaluator(cacheSettings);
};

OniyiCache.prototype.get = function get(hash, cb) {
  const self = this;
  const callback = _.isFunction(cb) ? cb : _.noop;

  const key = self.keyPrefix + hash;

  self.redisClient.hgetall(key, (getAllError, data) => {
    if (getAllError || data === null) {
      callback(getAllError, data);
      return;
    }
    if (!data.response) {
      self.redisClient.del(key, (error, result) => {
        if (error) {
          debug(error);
          return;
        }

        debug('removed %d entries from cache {%s} due to invalid data', result, hash);
      });

      callback(new TypeError('found invalid data in cache'));
      return;
    }

    Object.assign(data, {
      response: JSON.parse(data.response),
    });

    callback(null, data);
  });
};

OniyiCache.prototype.put = function put(data, cb) {
  const self = this;

  const callback = _.isFunction(cb) ? cb : _.noop;

  const key = self.keyPrefix + data.hash;

  if (data.response) {
    Object.assign(data, {
      response: serializeResponseObject(data.response),
    });
  }

  const saveIt = self.redisClient.multi();

  const selectedData = _.pick(data, ['response', 'raw', 'parsed']);
  // if we want to update expireAt only, redis will throw an error
  // since we are invoking hmset operation with no data provided
  if (!_.isEmpty(selectedData)) {
    saveIt.hmset(key, selectedData);
  }

  if (_.isNumber(data.expireAt)) {
    saveIt.expireat(key, data.expireAt);
  }

  saveIt.exec((err, result) => {
    if (err) {
      debug('Unable to execute "exec" command, error occurred: ', err);
    }

    debug('stored data in cache: %s. set timeout: %d', result[0], result[1]);
    callback();
  });
};

OniyiCache.prototype.putWithCommand = function putWithCommand(command, { hash, data }, cb) {
  const self = this;

  const callback = _.isFunction(cb) ? cb : _.noop;
  const key = self.keyPrefix + hash;

  self.redisClient[command](key, data, (err) => {
    if (err) {
      debug(err);
    }

    debug('command %s for hash %s for data %o was successful', command, hash, data);
    callback();
  });
};

OniyiCache.prototype.purge = function purge(hash, cb) {
  const self = this;

  const callback = _.isFunction(cb) ? cb : _.noop;

  const key = self.keyPrefix + hash;

  self.redisClient.del(key, (err, result) => {
    if (err) {
      debug(err);
      return;
    }
    debug('removed %d entries from cache {%s} due to invalid data', result, hash);
    callback(err, result === 1);
  });
};

// deprecation notice
OniyiCache.prototype.hash = util.deprecate(function hash(requestObject) {
  return this.makeHash(requestObject);
}, '"OniyiCache.hash" is deprecated! Use "OniyiCache.makeHash" instead');

module.exports = OniyiCache;
