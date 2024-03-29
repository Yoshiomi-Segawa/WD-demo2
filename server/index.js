/**
 * Copyright 2017 IBM Corp. All Rights Reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the 'License'); you may not
 * use this file except in compliance with the License. You may obtain a copy of
 * the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an 'AS IS' BASIS, WITHOUT
 * WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the
 * License for the specific language governing permissions and limitations under
 * the License.
 */

'use strict';

require('dotenv').config({
  silent: true
});

require('isomorphic-fetch');
const Promise = require('bluebird');
const queryString = require('query-string');
const queryBuilder = require('./query-builder');
const queryTrendBuilder = require('./query-builder-trending');
const discoEvents = require('./disco-events');
const WatsonDiscoverySetup = require('../lib/watson-discovery-setup');
const DiscoveryV1 = require('ibm-watson/discovery/v1');
const utils = require('../lib/utils');

/**
 * Back end server which handles initializing the Watson Discovery
 * service, and setting up route methods to handle client requests.
 */

var environment_id;
var collection_id;
const DEFAULT_NAME = 'airbnb-austin-data';
var discoveryDocs = [];
const fs = require('fs');
const path = require('path');
var arrayOfFiles = fs.readdirSync('./data/airbnb/');
arrayOfFiles.forEach(function(file) {
  discoveryDocs.push(path.join('./data/airbnb/', file));
});
// shorten the list if we are loading - trail version of IBM Cloud
// is limited to 256MB application size, so use this if you get
// out of memory errors.
discoveryDocs = discoveryDocs.slice(0,300);

const discovery = new DiscoveryV1({
  version: '2019-06-28',
  url: 'https://165.192.71.152:31843/discovery/zen-ys-wd201/instances/1567850968/api',
  authentication_type: 'icp4d',
  icp4d_access_token: 'eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VybmFtZSI6ImFkbWluIiwic3ViIjoiYWRtaW4iLCJpc3MiOiJLTk9YU1NPIiwiYXVkIjoiRFNYIiwicm9sZSI6IkFkbWluIiwicGVybWlzc2lvbnMiOltdLCJ1aWQiOiI5OTkiLCJpYXQiOjE1Njc4NTA5NzF9.CMplg1usLLEYmNmbgQ75vsJRGPNCDC8c21b48xXwQSnjTxjfEzfaRnpoieobEhJxM-pjVx2r0_bvg2JySuzGLCLvTm50qtTi3zF_JtAMDHMqwrCPZMSe6rpjpECXXSecqz1sHo8fdHa7FBDyPBy5tf_0Z5-_tlb7Npg3y-wDrayOwZEVinMUiDKG6yowtesQM8HB4Ai20qub3zbH3zBZXLrB0-w-9vtCGW1LdO6ZuXT7K_s4e1CveeSm4rU55ZOE09y8G0loXeTmHuKLaJ_4WLjYeu3DDVDNdu3byB9z1OS9528WRN1XzfJuBDBenbX8SLtW9oq8-bcxqH2Zp1dIXw',
  disable_ssl_verification: true,
});

// make our discovery queries promise functions
discovery.query = Promise.promisify(discovery.query);
discovery.createEvent = Promise.promisify(discovery.createEvent);


const discoverySetup = new WatsonDiscoverySetup(discovery);
const discoverySetupParams = {
  default_name: DEFAULT_NAME,
  config_name: 'airbnb-keyword-extraction'   // instead of 'Default Configuration'
};


const WatsonDiscoServer = new Promise((resolve) => {
  discoverySetup.setupDiscovery(discoverySetupParams, (err, data) => {
    if (err) {
      discoverySetup.handleSetupError(err);
    } else {
      console.log('Dicovery is ready!');
      // now load data into discovery service collection
      var collectionParams = data;

      // set collection creds - at this point the collectionParams
      // will point to the actual credentials, whether the user
      // entered them in .env for an existing collection, or if
      // we had to create them from scratch.
      environment_id = collectionParams.environment_id;
      collection_id = collectionParams.collection_id;
      console.log('environment_id: ' + environment_id);
      console.log('collection_id: ' + collection_id);
      queryBuilder.setEnvironmentId(environment_id);
      queryBuilder.setCollectionId(collection_id);
      queryTrendBuilder.setEnvironmentId(environment_id);
      queryTrendBuilder.setCollectionId(collection_id);
      discoEvents.setEnvironmentId(environment_id);
      discoEvents.setCollectionId(collection_id);

/* ys0910
      collectionParams.documents = discoveryDocs;
      console.log('Begin loading ' + discoveryDocs.length +
        ' json files into discovery. Please be patient as this can take several minutes.');
      discoverySetup.loadCollectionFiles(collectionParams);
*/
      resolve(createServer());
    }
  });
});

/**
 * createServer - create express server and handle requests
 * from client.
 */
function createServer() {
  const server = require('./express');

  server.get('/api/createEvent', (req, res) => {
    const { sessionToken, documentId } = req.query;

    // console.log('IN api/metrics');

    var discoEventsParams = discoEvents.createEvent(documentId, sessionToken);

    discovery.createEvent(discoEventsParams)
      .then(response => res.json(response))
      .catch(error => {
        if (error.message === 'Number of free queries per month exceeded') {
          res.status(429).json(error);
        } else {
          res.status(error.code).json(error);
        }
      });
  });

  // handles search request from search bar
  server.get('/api/trending', (req, res) => {
    const { query, filters, count } = req.query;

    console.log('In /api/trending: query = ' + query);

    // build params for the trending search request
    var params = {};
    params.query = query;

    // add any filters and a limit to the number of matches that can be found
    if (filters) {
      params.filter = filters;
    }
    params.count = count;

    var searchParams = queryTrendBuilder.search(params);
    discovery.query(searchParams)
      .then(response => res.json(response))
      .catch(error => {
        if (error.message === 'Number of free queries per month exceeded') {
          res.status(429).json(error);
        } else {
          res.status(error.code).json(error);
        }
      });
  });

  // handles search request from search bar
  server.get('/api/search', (req, res) => {
    const { query, filters, count, returnPassages, sort, queryType } = req.query;
    var params = {};

    console.log('In /api/search: query = ' + query);

    // add query and the type of query
    if (queryType == 'natural_language_query') {
      params.natural_language_query = query;
    } else {
      params.query = query;
    }

    // add any filters and a limit to the number of matches that can be found
    if (filters) {
      params.filter = filters;
    }

    params.count = count;
    params.passages_count = count;
    params.passages = returnPassages;
    if (! sort) {
      params.sort = utils.BY_HIGHEST_QUERY;
    } else {
      params.sort = sort;
    }

    var searchParams = queryBuilder.search(params);
    discovery.query(searchParams)
      .then(response => res.json(response))
      .catch(error => {
        if (error.message === 'Number of free queries per month exceeded') {
          res.status(429).json(error);
        } else {
          res.status(error.code).json(error);
        }
      });
  });

  // handles search string appened to url
  server.get('/:searchQuery', function(req, res){
    var searchQuery = req.params.searchQuery.replace(/\+/g, ' ');
    const qs = queryString.stringify({
      query: searchQuery,
      count: 1000,
      returnPassages: false,
      queryType: 'natural_language_query'
    });
    const fullUrl = req.protocol + '://' + req.get('host');

    console.log('In /:searchQuery: query = ' + qs);

    fetch(fullUrl + `/api/search?${qs}`)
      .then(response => {
        if (response.ok) {
          return response.json();
        } else {
          throw response;
        }
      })
      .then(json => {

        // get all the results data in right format
        var matches = utils.parseData(json);
        matches = utils.formatData(matches, []);
        var totals = utils.getTotals(matches);

        res.render('index',
          {
            data: matches,
            entities: json,
            categories: json,
            concepts: json,
            keywords: json,
            entityTypes: json,
            searchQuery,
            numMatches: matches.results.length,
            numPositive: totals.numPositive,
            numNeutral: totals.numNeutral,
            numNegative: totals.numNegative,
            error: null
          }
        );
      })
      .catch(response => {
        res.status(response.status).render('index', {
          error: (response.status === 429) ? 'Number of free queries per month exceeded' : 'Error fetching data'
        });
      });
  });

  // initial start-up request
  server.get('/*', function(req, res) {
    console.log('In /*');

    // this is the inital query to the discovery service
    console.log('Initial Search Query at start-up');
    const params = queryBuilder.search({
      natural_language_query: '',
      count: 1000,
      passages: false
    });
    return new Promise((resolve, reject) => {
      discovery.query(params)
        .then(results =>  {

          // get all the results data in right format
          var matches = utils.parseData(results);
          matches = utils.formatData(matches, []);
          var totals = utils.getTotals(matches);

          // const util = require('util');
          // console.log('++++++++++++ DISCO RESULTS ++++++++++++++++++++');
          // console.log(util.inspect(results, false, null));

          res.render('index', {
            data: matches,
            entities: results,
            categories: results,
            concepts: results,
            keywords: results,
            entityTypes: results,
            numMatches: matches.results.length,
            numPositive: totals.numPositive,
            numNeutral: totals.numNeutral,
            numNegative: totals.numNegative
          });

          resolve(results);
        })
        .catch(error => {
          console.error(error);
          reject(error);
        });
    });

  });

  return server;
}

module.exports = WatsonDiscoServer;
