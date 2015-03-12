'use strict';
var assert = require('assert');

var _ = require('lodash'),
	XXHash = require('xxhash');

var Evaluator = require('./lib/evaluator');

var includeRequestPropertiesInHash = ['uri', 'qs', 'method', 'authenticatedUser'],
	excludeRequestHeadersFromHash = ['cookie'];

var validHostConfigProperties = ['storePrivate', 'storeNoStore', 'ignoreNoLastMod', 'requestValidators', 'responseValidators'],
	mergeableEvaluatorConfigProperties = ['storePrivate', 'storeNoStore', 'ignoreNoLastMod'];

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

module.exports = OniyiCache;