'use strict';
var assert = require('assert');

var _ = require('lodash'),
	debug = require('debug'),
	makeRedisClient = require('make-redis-client'),
	XXHash = require('xxhash');

var Evaluator = require('./lib/evaluator');

// variables and functions
var moduleName = 'oniyi-cache';


var logError = debug(moduleName + ':error');
// set this namespace to log via console.error
logError.log = console.error.bind(console); // don't forget to bind to console!

var logWarn = debug(moduleName + ':warn');
// set all output to go via console.warn
logWarn.log = console.warn.bind(console);

var logDebug = debug(moduleName + ':debug');
// set all output to go via console.warn
logDebug.log = console.warn.bind(console);

var includeRequestPropertiesInHash = [
	'uri',
	'qs',
	'method',
	'authenticatedUser'
];

var excludeRequestHeadersFromHash = ['cookie'];

var validHostConfigProperties = [
	'storePrivate',
	'storeNoStore',
	'ignoreNoLastMod',
	'requestValidators',
	'responseValidators'
];

var mergeableEvaluatorConfigProperties = [
	'storePrivate',
	'storeNoStore',
	'ignoreNoLastMod'
];

var serializableResponseProperties = [
  // 'headers',
  'trailers',
  'method',
  'statusCode',
  'httpVersion',
  'httpVersionMajor',
  'httpVersionMinor'
];

function serializeResponseObject(responseObject) {
	return JSON.stringify(_.merge(_.pick(responseObject, serializableResponseProperties), {
		headers: _.omit(responseObject.headers, ['set-cookie']),
		fromCache: true
	}));
}

function OniyiCache(args) {
	var self = this;

	// check pre-requisites
	assert(_.isPlainObject(args), 'args must be provided as plain object');

	// extract global validator options
	self.globalConfig = _.merge({
		storePrivate: false,
		storeNoStore: false,
		ignoreNoLastMod: false,
		requestValidators: [],
		responseValidators: []
	}, _.pick(args, validHostConfigProperties));

	// extract the validator options per hostname from provided "hostConfig" object
	self.hostConfig = {};
	if (_.isPlainObject(args.hostConfig)) {
		self.hostConfig = _.reduce(args.hostConfig, function(result, conf, hostname) {
			result[hostname] = _.pick(conf, validHostConfigProperties);
			return result;
		}, self.hostConfig);
	}

	self.includeRequestPropertiesInHash = _.union(includeRequestPropertiesInHash, (_.isArray(args.includeRequestPropertiesInHash) ? args.includeRequestPropertiesInHash : []));
	self.excludeRequestHeadersFromHash = _.union(excludeRequestHeadersFromHash, (_.isArray(args.excludeRequestHeadersFromHash) ? args.excludeRequestHeadersFromHash : []));

	if (!args.redisClient) {
		args.redisClient = makeRedisClient(args.redis);
	}

	self.redisClient = args.redisClient;
}

OniyiCache.prototype.hash = function(requestObject) {
	var self = this;

	return XXHash.hash(
		new Buffer(
			JSON.stringify(
				_.merge(
					_.pick(requestObject, self.includeRequestPropertiesInHash), {
						headers: _.omit(requestObject.headers, self.excludeRequestHeadersFromHash)
					}))),
		0xCAFEBABE
	);
};

OniyiCache.prototype.addHostConfigs = function(config) {
	var self = this;

	_.forOwn(config, function(hostConfig, hostname) {
		if (_.isUndefined(self.hostConfig[hostname])) {
			self.hostConfig[hostname] = _.pick(hostConfig, validHostConfigProperties);
		}
	});
};

OniyiCache.prototype.setHostConfigs = function(config) {
	var self = this;

	_.forOwn(config, function(hostConfig, hostname) {
		self.hostConfig[hostname] = _.pick(hostConfig, validHostConfigProperties);
	});
};

OniyiCache.prototype.updateHostConfigs = function(config) {
	var self = this;

	_.forOwn(config, function(hostConfig, hostname) {
		self.hostConfig[hostname] = _.merge(
			self.hostConfig[hostname] || {},
			_.pick(hostConfig, validHostConfigProperties));
	});
};

OniyiCache.prototype.clearHostConfigs = function(hostnamesArray) {
	if (!_.isArray(hostnamesArray)) {
		return;
	}
	var self = this;
	hostnamesArray.forEach(function(hostname) {
		self.hostConfig[hostname] = {};
	});
};

OniyiCache.prototype.getEvaluator = function(hostname, config) {
	var self = this;
	var hostConfig = {};

	// if first argument is plain object, take that as "config" and ignore hostname
	if (_.isPlainObject(hostname)) {
		config = hostname;
		hostname = null;
	}

	// make sure config is defined and has the right format
	if (!_.isPlainObject(config)) {
		config = {};
	}

	// if hostname was provided and we have a valid config object for this hostname, load that config.
	if (_.isString(hostname) && _.isPlainObject(self.hostConfig[hostname])) {
		hostConfig = self.hostConfig[hostname];
	}

	// merge global cache settings with the specific ones for this hostname (if available) and the provided config options
	var cacheSettings = _.merge({},
		self.globalConfig,
		_.pick(hostConfig, mergeableEvaluatorConfigProperties),
		_.pick(config, mergeableEvaluatorConfigProperties));

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

OniyiCache.prototype.get = function(hash, callback) {
	var self = this;

	if (!_.isFunction(callback)) {
		callback = _.noop;
	}

	self.redisClient.hgetall(hash, function(err, data) {
		if (err) {
			return callback(err, null);
		}
		if (!data.response) {
			self.redisClient.del(hash, function(err, result) {
				if (err) {
					return logWarn(err);
				}
				logDebug('removed %d entries from cache {%s} due to invalid data', result, hash);
			});
			return callback(new TypeError('found invalid data in cache'));
		}
		data.response = JSON.parse(data.response);
		return callback(null, data);
	});
};

OniyiCache.prototype.put = function(data, callback) {
	var self = this;

	if (!_.isFunction(callback)) {
		callback = _.noop;
	}
	// hash, response, raw, parsed, expireAt

	if (_.isPlainObject(data.response)) {
		data.response = serializeResponseObject(data.response);
	}

	var saveIt = self.redisClient.multi();

	saveIt.hmset(data.hash, _.pick(data, ['response', 'raw', 'parsed']));

	if (_.isNumber(data.expireAt)) {
		saveIt.expireat(data.hash, data.expiresAt);
	}

	saveIt.exec(function(err, result) {
		logDebug('stored data in cache. result is %s', result);
		callback(err);
	});

};

OniyiCache.prototype.purge = function(hash, callback) {
	var self = this;

	self.redisClient.del(hash, function(err, result) {
		if (err) {
			return logWarn(err);
		}
		logDebug('removed %d entries from cache {%s} due to invalid data', result, hash);
		callback(err, result === 1);
	});
};

module.exports = OniyiCache;