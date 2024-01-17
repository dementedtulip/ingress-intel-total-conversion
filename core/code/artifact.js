/**
 * @file Provides functions related to Ingress artifacts, including setup, data request, and processing functions.
 * Added as part of the ingress #13magnus in november 2013, artifacts
 * are additional game elements overlayed on the intel map
 *
 * currently there are only jarvis-related entities
 * - `shards`: move between portals (along links) each hour. more than one can be at a portal.
 * - `targets`: specific portals - one per team.
 *
 * The artifact data includes details for the specific portals, so can be useful.
 * 2014-02-06: intel site updates hint at new 'amar artifacts', likely following the same system as above
 *
 * @namespace window.artifact
 */

window.artifact = function() {}

/**
 * Sets up artifact data fetching, layer creation, and UI elements.
 * @function window.artifact.setup
 */
window.artifact.setup = function() {
  artifact.REFRESH_JITTER = 2*60;  // 2 minute random period so not all users refresh at once
  artifact.REFRESH_SUCCESS = 60*60;  // 60 minutes on success
  artifact.REFRESH_FAILURE = 2*60;  // 2 minute retry on failure

  artifact.idle = false;
  artifact.clearData();

  addResumeFunction(artifact.idleResume);

  // move the initial data request onto a very short timer. prevents thrown exceptions causing IITC boot failures
  setTimeout (artifact.requestData, 1);

  artifact._layer = new L.LayerGroup();
  window.layerChooser.addOverlay(artifact._layer, 'Artifacts');

  $('<a>')
    .html('Artifacts')
    .attr({
      id: 'artifacts-toolbox-link',
      title: 'Show artifact portal list'
    })
    .click(window.artifact.showArtifactList)
    .appendTo('#toolbox');
}

/**
 * Requests artifact data from the server. If the map is in idle mode, sets a flag instead of sending a request.
 * @function window.artifact.requestData
 */
window.artifact.requestData = function() {
  if (isIdle()) {
    artifact.idle = true;
  } else {
    window.postAjax('getArtifactPortals', {}, artifact.handleSuccess, artifact.handleError);
  }
}

/**
 * Resumes artifact data requests when coming out of idle mode.
 * @function window.artifact.idleResume
 */
window.artifact.idleResume = function() {
  if (artifact.idle) {
    artifact.idle = false;
    artifact.requestData();
  }
}

/**
 * Handles successful artifact data response from the server.
 * @function window.artifact.handleSuccess
 * @param {Object} data - Artifact data received from the server.
 */
window.artifact.handleSuccess = function(data) {
  artifact.processData (data);

  // start the next refresh at a multiple of REFRESH_SUCCESS seconds, plus a random REFRESH_JITTER amount to prevent excessive server hits at one time
  var now = Date.now();
  var nextTime = Math.ceil(now/(artifact.REFRESH_SUCCESS*1000))*(artifact.REFRESH_SUCCESS*1000) + Math.floor(Math.random()*artifact.REFRESH_JITTER*1000);

  setTimeout (artifact.requestData, nextTime - now);
}

/**
 * Handles failure in artifact data request. Schedules a new request after a short delay.
 * @function window.artifact.handleFailure
 * @param {Object} data - Response data from the failed request.
 */
window.artifact.handleFailure = function(data) {
  // no useful data on failure - do nothing

  setTimeout (artifact.requestData, artifact.REFRESH_FAILURE*1000);
}

/**
 * Processes artifact data. Clears previous data, processes new results, runs hooks, and updates the artifact layer.
 * @function window.artifact.processData
 * @param {Object} data - Artifact data to process.
 */
window.artifact.processData = function(data) {

  if (data.error || !data.result) {
    log.warn('Failed to find result in getArtifactPortals response');
    return;
  }

  var oldArtifacts = artifact.entities;
  artifact.clearData();

  artifact.processResult(data.result);
  runHooks('artifactsUpdated', {old: oldArtifacts, 'new': artifact.entities});

  // redraw the artifact layer
  artifact.updateLayer();

}

/**
 * Clears all stored artifact data.
 * @function window.artifact.clearData
 */
window.artifact.clearData = function() {
  artifact.portalInfo = {};
  artifact.artifactTypes = {};

  artifact.entities = [];
}

/**
 * Processes the results from artifact portal data. Extracts and stores portal data for each artifact type.
 * @function window.artifact.processResult
 * @param {Object} portals - The artifact portal data.
 */
window.artifact.processResult = function (portals) {
  // portals is an object, keyed from the portal GUID, containing the portal entity array

  for (var guid in portals) {
    var ent = portals[guid];
    var data = decodeArray.portal(ent, 'summary');

    if (!data.artifactBrief) {
      // 2/12/2017 - Shard removed from a portal leaves it in artifact results but has no artifactBrief
      continue;
    }

    // we no longer know the faction for the target portals, and we don't know which fragment numbers are at the portals
    // all we know, from the portal summary data, for each type of artifact, is that each artifact portal is
    // - a target portal or not - no idea for which faction
    // - has one (or more) fragments, or not

    if (!artifact.portalInfo[guid]) artifact.portalInfo[guid] = {};

    // store the decoded data - needed for lat/lng for layer markers
    artifact.portalInfo[guid]._data = data;

    for(var type in data.artifactBrief.target) {
      if (!artifact.artifactTypes[type]) artifact.artifactTypes[type] = {};

      if (!artifact.portalInfo[guid][type]) artifact.portalInfo[guid][type] = {};

      artifact.portalInfo[guid][type].target = TEAM_NONE;  // as we no longer know the team...
    }

    for(var type in data.artifactBrief.fragment) {
      if (!artifact.artifactTypes[type]) artifact.artifactTypes[type] = {};

      if (!artifact.portalInfo[guid][type]) artifact.portalInfo[guid][type] = {};

      artifact.portalInfo[guid][type].fragments = true; //as we no longer have a list of the fragments there
    }


    // let's pre-generate the entities needed to render the map - array of [guid, timestamp, ent_array]
    artifact.entities.push ( [guid, data.timestamp, ent] );

  }

}

/**
 * Returns the types of artifacts currently known.
 * @function window.artifact.getArtifactTypes
 * @returns {Array} An array of artifact type strings.
 */
window.artifact.getArtifactTypes = function() {
  return Object.keys(artifact.artifactTypes);
}

/**
 * Determines if a given type is a knowable artifact.
 * @function window.artifact.isArtifact
 * @param {string} type - The type to check.
 * @returns {boolean} True if the type is an artifact, false otherwise.
 */
window.artifact.isArtifact = function(type) {
  return type in artifact.artifactTypes;
}

/**
 * Used to render portals that would otherwise be below the visible level.
 * @function window.artifact.getArtifactEntities
 * @returns {Array} An array of artifact entities.
 */
window.artifact.getArtifactEntities = function() {
  return artifact.entities;
}

/**
 * Gets the portals that are relevant to the artifacts.
 * @function window.artifact.getInterestingPortals
 * @returns {Array} An array of portal GUIDs.
 */
window.artifact.getInterestingPortals = function() {
  return Object.keys(artifact.portalInfo);
}

/**
 * Quickly checks if a portal is relevant to any type of artifacts.
 * @function window.artifact.isInterestingPortal
 * @param {string} guid - The GUID of the portal to check.
 * @returns {boolean} True if the portal is involved in artifacts, false otherwise.
 */
window.artifact.isInterestingPortal = function(guid) {
  return guid in artifact.portalInfo;
}

/**
 * Retrieves the artifact data for a specified artifact id (e.g. 'jarvis'), if available.
 * @function window.artifact.getPortalData
 * @param {string} guid - The GUID of the portal.
 * @param {string} artifactId - The ID of the artifact type.
 * @returns {Object|false} Artifact data for the specified portal and type, or undefined if not available.
 */
window.artifact.getPortalData = function(guid,artifactId) {
  return artifact.portalInfo[guid] && artifact.portalInfo[guid][artifactId];
}

/**
 * Updates the artifact layer on the map based on the current artifact data.
 * @function window.artifact.updateLayer
 */
window.artifact.updateLayer = function() {
  artifact._layer.clearLayers();

  $.each(artifact.portalInfo, function(guid,data) {
    var latlng = L.latLng ([data._data.latE6/1E6, data._data.lngE6/1E6]);

    $.each(data, function(type,detail) {

      // we'll construct the URL form the type - stock seems to do that now

      var iconUrl;
      if (data[type].target !== undefined) {
        // target portal
        var iconUrl = '//commondatastorage.googleapis.com/ingress.com/img/map_icons/marker_images/'+type+'_shard_target.png'
        var iconSize = 100/2;
        var opacity = 1.0;

        var icon = L.icon({
          iconUrl: iconUrl,
          iconSize: [iconSize,iconSize],
          iconAnchor: [iconSize/2,iconSize/2]
        });

        var marker = L.marker (latlng, {icon: icon, interactive: false, keyboard: false, opacity: opacity });

        artifact._layer.addLayer(marker);

      } else if (data[type].fragments) {
        // fragment(s) at portal

        var iconUrl = '//commondatastorage.googleapis.com/ingress.com/img/map_icons/marker_images/'+type+'_shard.png'
        var iconSize = 60/2;
        var opacity = 0.6;

        var icon = L.icon({
          iconUrl: iconUrl,
          iconSize: [iconSize,iconSize],
          iconAnchor: [iconSize/2,iconSize/2],
        });

        var marker = L.marker (latlng, {icon: icon, interactive: false, keyboard: false, opacity: opacity });

        artifact._layer.addLayer(marker);

      }

    });  //end $.each(data, function(type,detail)

  }); //end $.each(artifact.portalInfo, function(guid,data)

}

/**
 * Displays a dialog listing all portals involved with artifacts, organized by artifact types.
 * @function window.artifact.showArtifactList
 */
window.artifact.showArtifactList = function() {
  var html = '';

  if (Object.keys(artifact.artifactTypes).length == 0) {
    html += '<i>No artifacts at this time</i>';
  }

  var first = true;
  $.each(artifact.artifactTypes, function(type,type2) {
    // no nice way to convert the Niantic internal name into the correct display name
    // (we do get the description string once a portal with that shard type is selected - could cache that somewhere?)
    var name = type.capitalize() + ' shards';

    if (!first) html += '<hr>';
    first = false;
    html += '<div><b>'+name+'</b></div>';

    html += '<table class="artifact artifact-'+type+'">';
    html += '<tr><th>Portal</th><th>Details</th></tr>';

    var tableRows = [];

    $.each(artifact.portalInfo, function(guid, data) {
      if (type in data) {
        // this portal has data for this artifact type - add it to the table

        var onclick = 'zoomToAndShowPortal(\''+guid+'\',['+data._data.latE6/1E6+','+data._data.lngE6/1E6+'])';
        var row = '<tr><td class="portal"><a onclick="'+onclick+'">'+escapeHtmlSpecialChars(data._data.title)+'</a></td>';

        row += '<td class="info">';

        if (data[type].target !== undefined) {
          if (data[type].target == TEAM_NONE) {
            row += '<span class="target">Target Portal</span> ';
          } else {
            row += '<span class="target '+TEAM_TO_CSS[data[type].target]+'">'+(data[type].target==TEAM_RES?'Resistance':'Enlightened')+' target</span> ';
          }
        }

        if (data[type].fragments) {
          if (data[type].target !== undefined) {
            row += '<br>';
          }
          var fragmentName = 'shard';
//          row += '<span class="fragments'+(data[type].target?' '+TEAM_TO_CSS[data[type].target]:'')+'">'+fragmentName+': #'+data[type].fragments.join(', #')+'</span> ';
          row += '<span class="fragments'+(data[type].target?' '+TEAM_TO_CSS[data[type].target]:'')+'">'+fragmentName+': yes</span> ';
        }

        row += '</td></tr>';

        // sort by target portals first, then by portal GUID
        var sortVal = (data[type].target !== undefined ? 'A' : 'Z') + guid;

        tableRows.push ( [sortVal, row] );
      }
    });

    // check for no rows, and add a note to the table instead
    if (tableRows.length == 0) {
      html += '<tr><td colspan="2"><i>No portals at this time</i></td></tr>';
    }

    // sort the rows
    tableRows.sort(function(a,b) {
      if (a[0] == b[0]) return 0;
      else if (a[0] < b[0]) return -1;
      else return 1;
    });

    // and add them to the table
    html += tableRows.map(function(a){return a[1];}).join('');


    html += '</table>';
  });

  // In Summer 2015, Niantic changed the data format for artifact portals. We no longer know:
  // - Which team each target portal is for - only that it is a target
  // - Which shards are at each portal, just that it has one or more shards
  // You can select a portal and the detailed data contains the list of shard numbers, but there's still no
  // more information on targets

  dialog({
    title: 'Artifacts',
    id: 'iitc-artifacts',
    html: html,
    width: 400,
    position: {my: 'right center', at: 'center-60 center', of: window, collision: 'fit'}
  });

}
