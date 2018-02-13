'use strict';

/*
 * The basic concept here has been borrowed from Chris Corbyn's node-http-cache.
 *
 */

// node core modules

// 3rd party modules
const _ = require('lodash');

// internal modules

const maxAgeRegex = /max-age=[0-9]+/;
const maxAgeZeroRegex = /max-age=(0|-[0-9]+)/;

/**
 * Namespace to house all built-in validators.
 */
const Validators = ({
  request: {
    disableCache: (requestOptions, evaluator) => {
      if (requestOptions.disableCache === true) {
        evaluator.flagStorable(false);
        evaluator.flagRetrievable(false);
        return true;
      }

      return false;
    },
    forceFresh: (requestOptions, evaluator) => {
      if (requestOptions.forceFresh === true) {
        evaluator.flagRetrievable(false);
        return true;
      }

      return false;
    },
    /**
     * Checks if the request's max-age is zero, rendering it uncacheable.
     *
     * RFC 2616 Section 13.1.6.
     */
    maxAgeZero: (requestOptions, evaluator) => {
      if ((requestOptions.headers['cache-control'] || '').match(maxAgeZeroRegex)) {
        evaluator.flagStorable(true);
        evaluator.flagRetrievable(false);
        return true;
      }

      return false;
    },
    /**
     * Checks if request cache-control/pragma states no-cache.
     *
     * RFC 2616 Section 14.9.
     */
    noCache: (requestOptions, evaluator) => {
      if ((requestOptions.headers['cache-control'] || '').match(/no-cache/)) {
        evaluator.flagStorable(false);
        evaluator.flagRetrievable(false);
        return true;
      }
      if ((requestOptions.headers.pragma || '') === 'no-cache') {
        evaluator.flagStorable(false);
        evaluator.flagRetrievable(false);
        return true;
      }

      return false;
    },
    /**
     * Checks if request cache-control states no-cache, rendering it uncacheable.
     *
     * RFC 2616 Section 14.9.
     */
    noStore: (requestOptions, evaluator) => {
      if ((requestOptions.headers['cache-control'] || '').match(/no-store/)) {
        evaluator.flagStorable(false);
        evaluator.flagRetrievable(false);
        return true;
      }

      return false;
    },
    /**
     * Blindly make the request cacheable if the method is GET or HEAD.
     *
     * Anything else is uncacheable. RFC 2616 Section 13.9.
     *
     * This is the final validator in the listener chain.
     */
    methodGetOrHead: (requestOptions, evaluator) => {
      const flag = /get|head/i.test(requestOptions.method);
      evaluator.flagRetrievable(flag);
      return true;
    },
  },
  response: {
    /**
     * Checks if response cache-control states private, rendering it uncacheable.
     *
     * RFC 2616 Section 14.9.
     */
    onlyPrivate: (response, evaluator) => {
      if ((response.headers['cache-control'] || '').match(/private/)) {
        evaluator.flagPrivate(true);
        if (!evaluator.storePrivate) {
          evaluator.flagStorable(false);
          return true;
        }
      }

      return false;
    },
    /**
     * Checks if response cache-control states no-store, rendering it uncacheable.
     *
     * RFC 2616 Section 14.9.
     */
    noStore: (response, evaluator) => {
      if ((response.headers['cache-control'] || '').match(/no-store(?!=)/) && !evaluator.storeNoStore) {
        evaluator.flagStorable(false);
        return true;
      }

      return false;
    },
    /**
     * Checks if response cache-control states max-age=0, rendering it uncacheable.
     *
     * RFC 2616 Section 14.9.
     */
    maxAgeZero: (response, evaluator) => {
      if ((response.headers['cache-control'] || '').match(maxAgeZeroRegex)) {
        evaluator.flagStorable(false);
        return true;
      }

      return false;
    },
    /**
     * Checks if response cache-control states max-age, allowing it to be cached.
     *
     * RFC 2616 Section 14.9.
     */
    maxAgeFuture: (response, evaluator) => {
      if ((response.headers['cache-control'] || '').match(maxAgeRegex)) {
        evaluator.flagStorable(true);
        return true;
      }

      return false;
    },
    /**
     * Checks if the weak validator Last-Modified is present in the response.
     *
     * RFC 2616 Section 13.3.1.
     */
    lastModified: (response, evaluator) => {
      if (typeof response.headers['last-modified'] !== 'undefined' && !evaluator.ignoreNoLastMod) {
        evaluator.flagStorable(true);
        return true;
      }

      return false;
    },
    /**
     * Checks if the strong validator ETag is present in the response.
     *
     * RFC 2616 Section 13.3.2.
     */
    eTag: (response, evaluator) => {
      if (typeof response.headers.etag !== 'undefined') {
        evaluator.flagStorable(true);
        return true;
      }

      return false;
    },
    /**
     * Invalidates HTTP response codes as stipulated in RFC 2616.
     */
    statusCodes: (response, evaluator) => {
      const cacheableStatusCodes = {
        200: 'OK',
        203: 'Non-Authoritative Information',
        300: 'Multiple Choices',
        301: 'Moved Permanently',
        401: 'Unauthorized',
      };

      if ((cacheableStatusCodes[response.statusCode])) {
        evaluator.flagStorable(true);
        return true;
      }

      return false;
    },
  },
});

Object.assign(Validators, {
  requestValidators: _.values(Validators.request),
  responseValidators: _.values(Validators.response),
});

module.exports = Validators;
