/** @scratch /panels/5
 *
 * include::panels/weightedterms.asciidoc[]
 */

/** @scratch /panels/terms/0
 *
 * == weightedterms
 * Status: *Experimental*
 *
 * A table, bar chart or pie chart based on the results of an Elasticsearch terms facet.
 *
 */
define([
  'angular',
  'app',
  'lodash',
  'jquery',
  'kbn'
],
function (angular, app, _, $, kbn) {
  'use strict';

  var module = angular.module('kibana.panels.weightedterms', []);
  app.useModule(module);

  module.controller('weightedterms', function($scope, $q, $http, querySrv, dashboard, filterSrv, fields, alertSrv) {
    $scope.panelMeta = {
      modals : [
        {
          description: "Inspect",
          icon: "icon-info-sign",
          partial: "app/partials/inspector.html",
          show: $scope.panel.spyable
        }
      ],
      editorTabs : [
        {title:'Queries', src:'app/partials/querySelect.html'}
      ],
      status  : "Experimental",
      description : "Displays the results of an elasticsearch facet as a pie chart, bar chart, or a "+
        "table"
    };

    // Set and populate defaults
    var _d = {
      /** @scratch /panels/weightedterms/5
       * === Parameters
       *
       * field:: The field on which to computer the facet
       */
      field   : '_type',
      /** @scratch /panels/weightedterms/5
       * filter:: regex string for filtering term values
       */
      filter : '',
      /** @scratch /panels/weightedterms/5
       * missing:: Set to false to disable the display of a counter showing how much results are
       * missing the field
       */
      missing : true,
      /** @scratch /panels/weightedterms/5
       * other:: Set to false to disable the display of a counter representing the aggregate of all
       * values outside of the scope of your +size+ property
       */
      other   : true,
      /** @scratch /panels/weightedterms/5
       * size:: Show this many terms
       */
      size    : 10,
      style   : { "font-size": '10pt'},
      /** @scratch /panels/weightedterms/5
       * donut:: In pie chart mode, draw a hole in the middle of the pie to make a tasty donut.
       */
      donut   : false,
      /** @scratch /panels/weightedterms/5
       * tilt:: In pie chart mode, tilt the chart back to appear as more of an oval shape
       */
      tilt    : false,
      /** @scratch /panels/weightedterms/5
       * lables:: In pie chart mode, draw labels in the pie slices
       */
      labels  : true,
      /** @scratch /panels/weightedterms/5
       * arrangement:: In bar or pie mode, arrangement of the legend. horizontal or vertical
       */
      arrangement : 'horizontal',
      /** @scratch /panels/weightedterms/5
       * chart:: table, bar or pie
       */
      chart       : 'bar',
      /** @scratch /panels/weightedterms/5
       * counter_pos:: The location of the legend in respect to the chart, above, below, or none.
       */
      counter_pos : 'above',
      /** @scratch /panels/weightedterms/5
       * spyable:: Set spyable to false to disable the inspect button
       */
      spyable     : true,
      /** @scratch /panels/weightedterms/5
       *
       * ==== Queries
       * queries object:: This object describes the queries to use on this panel.
       * queries.mode::: Of the queries available, which to use. Options: +all, pinned, unpinned, selected+
       * queries.ids::: In +selected+ mode, which query ids are selected.
       */
      queries     : {
        mode        : 'all',
        ids         : []
      }
    };

    _.defaults($scope.panel,_d);

    $scope.init = function () {
      $scope.hits = 0;

      $scope.$on('refresh',function(){
        $scope.get_data();
      });

      // On initial load, we'll grab the weights once, then load the log data.
      // Subsequent panel refreshes will then only grab the log data, which
      // implies you need to refresh the whole page to re-grab weights.
      $scope.get_weights().always($scope.get_data);
    };

    $scope.get_weights = function() {
      var weightsFileUrl = $scope.panel.weights_file_url;
      var weightsFileDef = $q.defer();

      if (weightsFileUrl) {
        var errorDefaultWeights = function() {
          $scope.panel.weighted_terms = {};
          alertSrv.set($scope.panel.title, 'panel unable to load from: ' + weightsFileUrl +
              ' so continuing without weights.', 'error');
          weightsFileDef.reject();
        }

        $http.get(weightsFileUrl, { responseType: 'json' })
          .success(function(data) {
            if (data) {
              alertSrv.set($scope.panel.title, 'panel using weights loaded from: ' + weightsFileUrl, 'info');
              $scope.panel.weighted_terms = data;
              weightsFileDef.resolve();
            } else {
              errorDefaultWeights();
            }
          })
          .error(function(data) {
            console.log(data);
            errorDefaultWeights();
          });
      } else {
        $scope.panel.weighted_terms = {};
        weightsFileDef.resolve();
      }

      return weightsFileDef.promise;
    };

    $scope.get_data = function() {
      // Make sure we have everything for the request to complete
      if(dashboard.indices.length === 0) {
        return;
      }

      $scope.panelMeta.loading = true;
      var request,
        results,
        boolQuery,
        queries;

      $scope.field = _.contains(fields.list,$scope.panel.field+'.raw') ?
        $scope.panel.field+'.raw' : $scope.panel.field;

      request = $scope.ejs.Request().indices(dashboard.indices);

      $scope.panel.queries.ids = querySrv.idsByMode($scope.panel.queries);
      queries = querySrv.getQueryObjs($scope.panel.queries.ids);

      // This could probably be changed to a BoolFilter
      boolQuery = $scope.ejs.BoolQuery();
      _.each(queries,function(q) {
        boolQuery = boolQuery.should(querySrv.toEjsObj(q));
      });

      // --- Custom Aggregation Query building code --- //

      // We need to build the aggregation query manually here, because the
      // elastic.js version doesn't support it yet. This code should be
      // refactored when that library is upgraded.
      var aggQuery = {};

      aggQuery['weightedterms'] = {
        filter: $scope.ejs.QueryFilter($scope.ejs.FilteredQuery(
            boolQuery, filterSrv.getBoolFilter(filterSrv.ids())
          ))._self()
      };

      if ($scope.panel.agg_field_1) {
        var aggField1 = {};
        aggField1[$scope.panel.agg_field_1] = {
          terms: {
            field: $scope.panel.agg_field_1,
            size: $scope.panel.size,
            exclude: $scope.panel.filter
          }
        };

        if ($scope.panel.agg_field_2) {
          var aggField2 = {};
          aggField2[$scope.panel.agg_field_2] = {
            terms: {
              field: $scope.panel.agg_field_2
            }
          };
          aggField1[$scope.panel.agg_field_1]['aggregations'] = aggField2;
        }

        aggQuery['weightedterms']['aggregations'] = aggField1;
      }

      request.size(0)._self()['aggregations'] = aggQuery;

      // --- End of Custom Aggregation Query building code --- //

      // Populate the inspector panel
      $scope.inspector = angular.toJson(JSON.parse(request.toString()),true);

      results = request.doSearch();

      // Populate scope when we have results
      results.then(function(results) {
        $scope.panelMeta.loading = false;
        $scope.results = results;
        $scope.$emit('render');
      });
    };

    $scope.build_search = function(term,negate) {
      if(_.isUndefined(term.meta)) {
        filterSrv.set({type:'terms',field:$scope.field,value:term.label,
          mandate:(negate ? 'mustNot':'must')});
      } else if(term.meta === 'missing') {
        filterSrv.set({type:'exists',field:$scope.field,
          mandate:(negate ? 'must':'mustNot')});
      } else {
        return;
      }
    };

    $scope.set_refresh = function (state) {
      $scope.refresh = state;
    };

    $scope.close_edit = function() {
      if($scope.refresh) {
        $scope.get_data();
      }
      $scope.refresh =  false;
      $scope.$emit('render');
    };

    $scope.showMeta = function(term) {
      if(_.isUndefined(term.meta)) {
        return true;
      }
      if(term.meta === 'other' && !$scope.panel.other) {
        return false;
      }
      if(term.meta === 'missing' && !$scope.panel.missing) {
        return false;
      }
      return true;
    };

  });

  module.directive('termsChart', function(querySrv) {
    return {
      restrict: 'A',
      link: function(scope, elem) {
        var plot;

        // Receive render events
        scope.$on('render',function(){
          render_panel();
        });

        function build_results() {
          // Collect the weighted counts for each term
          var weightedData = [];
          _.each(scope.results.aggregations['weightedterms'][scope.panel.agg_field_1]['buckets'], function(agg) {
            var key = agg['key'],
                count;

            if (_.has(scope.panel.weighted_terms, key)) {
              var weight = (scope.panel.weighted_terms[key] || 1.0);
              count = weight * agg['doc_count'];
              console.log('Adjusting ' + key + ' doc_count ' + agg['doc_count'] + ' by ' + weight + 'x')
            } else {
              count = agg['doc_count'];
            }

            weightedData.push({ key: key, count: count });
          });

          // Now sort them and transform into plot format
          var k = 0;
          scope.data = [];

          _.each(_.sortBy(weightedData, 'count').reverse(), function(v) {
            scope.data.push({ label: v.key, data: [[k, v.count]], actions: true });
            k = k + 1;
          });
        }

        // Function for rendering panel
        function render_panel() {
          var chartData;

          build_results();

          // IE doesn't work without this
          elem.css({height:scope.panel.height||scope.row.height});

          // Make a clone we can operate on.
          chartData = _.clone(scope.data);
          chartData = scope.panel.missing ? chartData :
            _.without(chartData,_.findWhere(chartData,{meta:'missing'}));
          chartData = scope.panel.other ? chartData :
          _.without(chartData,_.findWhere(chartData,{meta:'other'}));

          // Populate element.
          require(['jquery.flot.pie'], function(){
            // Populate element
            try {
              // Add plot to scope so we can build out own legend
              if(scope.panel.chart === 'bar') {
                plot = $.plot(elem, chartData, {
                  legend: { show: false },
                  series: {
                    lines:  { show: false, },
                    bars:   { show: true,  fill: 1, barWidth: 0.8, horizontal: false },
                    shadowSize: 1
                  },
                  yaxis: { show: true, min: 0, color: "#c8c8c8" },
                  xaxis: { show: false },
                  grid: {
                    borderWidth: 0,
                    borderColor: '#c8c8c8',
                    color: "#c8c8c8",
                    hoverable: true,
                    clickable: true
                  },
                  colors: querySrv.colors
                });
              }
              if(scope.panel.chart === 'pie') {
                var labelFormat = function(label, series){
                  return '<div ng-click="build_search(panel.field,\''+label+'\')'+
                    ' "style="font-size:8pt;text-align:center;padding:2px;color:white;">'+
                    label+'<br/>'+Math.round(series.percent)+'%</div>';
                };

                plot = $.plot(elem, chartData, {
                  legend: { show: false },
                  series: {
                    pie: {
                      innerRadius: scope.panel.donut ? 0.4 : 0,
                      tilt: scope.panel.tilt ? 0.45 : 1,
                      radius: 1,
                      show: true,
                      combine: {
                        color: '#999',
                        label: 'The Rest'
                      },
                      stroke: {
                        width: 0
                      },
                      label: {
                        show: scope.panel.labels,
                        radius: 2/3,
                        formatter: labelFormat,
                        threshold: 0.1
                      }
                    }
                  },
                  grid:   { hoverable: true, clickable: true, color: '#c8c8c8' },
                  colors: querySrv.colors
                });
              }

              // Populate legend
              if(elem.is(":visible")){
                setTimeout(function(){
                  scope.legend = plot.getData();
                  if(!scope.$$phase) {
                    scope.$apply();
                  }
                });
              }

            } catch(e) {
              elem.text(e);
            }
          });
        }

        elem.bind("plotclick", function (event, pos, object) {
          if(object) {
            scope.build_search(scope.data[object.seriesIndex]);
          }
        });

        var $tooltip = $('<div>');
        elem.bind("plothover", function (event, pos, item) {
          if (item) {
            var value = scope.panel.chart === 'bar' ? item.datapoint[1] : item.datapoint[1][0][1];
            $tooltip
              .html(
                kbn.query_color_dot(item.series.color, 20) + ' ' +
                kbn.xmlEnt(item.series.label) + " (" + value.toFixed(0)+")"
              )
              .place_tt(pos.pageX, pos.pageY);
          } else {
            $tooltip.remove();
          }
        });

      }
    };
  });

});
