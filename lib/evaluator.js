'use strict';

// node core modules

// 3rd party modules
const _ = require('lodash');

// internal modules
const validators = require('./validators.js');

const flagValidator = flag => (_.isUndefined(flag) ? true : !!flag);

function Evaluator({
  storePrivate,
  storeNoStore,
  ignoreNoLastMod,
  requestValidator = [],
  responseValidator = [],
} = {}) {
  this.storePrivate = storePrivate;
  this.storeNoStore = storeNoStore;
  this.ignoreNoLastMod = ignoreNoLastMod;
  this.requestValidators = requestValidator.concat(
    validators.requestValidators,
  );
  this.responseValidators = responseValidator.concat(
    validators.responseValidators,
  );
}

Evaluator.prototype.flagStorable = function flagStorable(flag) {
  if (_.isUndefined(this.storable)) {
    this.storable = flagValidator(flag);
  }
};

Evaluator.prototype.flagRetrievable = function flagRetrievable(flag) {
  if (_.isUndefined(this.retrievable)) {
    this.retrievable = flagValidator(flag);
  }
};

Evaluator.prototype.flagPrivate = function flagPrivate(flag) {
  if (_.isUndefined(this.private)) {
    this.private = flagValidator(flag);
  }
};

Evaluator.prototype.isRetrievable = function isRetrievable(requestOptions) {
  const self = this;
  if (_.isUndefined(self.retrievable)) {
    // concatenate validators from this particular request with the default RFC 2616 cache validators
    self.requestValidators.some(validator => validator(requestOptions, self));
  }

  return self.retrievable;
};

Evaluator.prototype.isStorable = function isStorable(response) {
  const self = this;
  if (_.isUndefined(self.storable)) {
    // concatenate validators from this particular request with the default RFC 2616 cache validators
    self.responseValidators.some(validator => validator(response, self));
  }

  return self.storable;
};

module.exports = Evaluator;
