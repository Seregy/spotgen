var Artist = require('./artist')
var Album = require('./album')
var CSV = require('./csv')
var Queue = require('./queue')
var Top = require('./top')
var Track = require('./track')
var Similar = require('./similar')

/**
 * Create a playlist.
 * @constructor
 * @param {string} str - A newline-separated string of
 * entries on the form `TITLE - ARTIST`. May also contain
 * `#ALBUM`, `#ARTIST`, `#ORDER` and `#GROUP` directives.
 */
function Playlist (str) {
  /**
   * Playlist alternating.
   */
  this.alternating = null

  /**
   * Whether to output as CSV.
   */
  this.csv = false

  /**
   * List of entries.
   */
  this.entries = new Queue()

  /**
   * Playlist grouping.
   */
  this.grouping = null

  /**
   * Playlist order.
   */
  this.ordering = null

  /**
   * Whether to remove duplicates.
   */
  this.unique = true

  str = str.trim()
  if (str !== '') {
    var lines = str.split(/\r|\n|\r\n/)
    while (lines.length > 0) {
      var line = lines.shift()
      if (line.match(/^#(SORT|ORDER)\s+BY/i)) {
        var orderMatch = line.match(/^#(SORT|ORDER)\s+BY\s+(.*)/i)
        this.ordering = orderMatch[2].toLowerCase()
      } else if (line.match(/^#GROUP\s+BY/i)) {
        var groupMatch = line.match(/^#GROUP\s+BY\s+(.*)/i)
        this.grouping = groupMatch[1].toLowerCase()
      } else if (line.match(/^#ALTERNATE\s+BY/i)) {
        var alternateMatch = line.match(/^#ALTERNATE\s+BY\s+(.*)/i)
        this.alternating = alternateMatch[1].toLowerCase()
      } else if (line.match(/^#(DUP(LICATES?)?|NONUNIQUE|NONDISTINCT)/i)) {
        this.unique = false
      } else if (line.match(/^#(UNIQUE|DISTINCT)/i)) {
        this.unique = true
      } else if (line.match(/^#[CSV]+/i)) {
        this.csv = true
      } else if (line.match(/^##/i) || line.match(/^#EXTM3U/i)) {
        // comment
      } else if (line.match(/^#ALBUM(ID)?[0-9]*\s+/i)) {
        var albumMatch = line.match(/^#ALBUM((ID)?)([0-9]*)\s+(.*)/i)
        var albumId = albumMatch[2]
        var albumLimit = parseInt(albumMatch[3])
        var albumEntry = albumMatch[4]
        var album = new Album(albumEntry)
        album.setLimit(albumLimit)
        if (albumId) {
          album.fetchTracks = false
        }
        this.entries.add(album)
      } else if (line.match(/^#ARTIST[0-9]*\s+/i)) {
        var artistMatch = line.match(/^#ARTIST([0-9]*)\s+(.*)/i)
        var artistLimit = parseInt(artistMatch[1])
        var artistEntry = artistMatch[2]
        var artist = new Artist(artistEntry)
        artist.setLimit(artistLimit)
        this.entries.add(artist)
      } else if (line.match(/^#TOP[0-9]*\s+/i)) {
        var topMatch = line.match(/^#TOP([0-9]*)\s+(.*)/i)
        var topLimit = parseInt(topMatch[1])
        var topEntry = topMatch[2]
        var top = new Top(topEntry)
        top.setLimit(topLimit)
        this.entries.add(top)
      } else if (line.match(/^#SIMILAR[0-9]*\s+/i)) {
        var similarMatch = line.match(/^#SIMILAR([0-9]*)\s+(.*)/i)
        var similarLimit = parseInt(similarMatch[1])
        var similarEntry = similarMatch[2]
        var similar = new Similar(similarEntry)
        similar.setLimit(similarLimit)
        this.entries.add(similar)
      } else if (line.match(/^#EXTINF/i)) {
        var match = line.match(/^#EXTINF:[0-9]+,(.*)/i)
        if (match) {
          this.entries.add(new Track(match[1]))
          if (lines.length > 0 &&
              !lines[0].match(/^#/)) {
            lines.shift()
          }
        }
      } else if (line.match(/spotify:track:[0-9a-z]+/i)) {
        var uriMatch = line.match(/spotify:track:[0-9a-z]+/i)
        var uri = uriMatch[0]
        var uriTrack = new Track(uri)
        this.entries.add(uriTrack)
      } else if (line !== '') {
        var track = new Track(line)
        this.entries.add(track)
      }
    }
  }
}

/**
 * Alternate the playlist entries.
 */
Playlist.prototype.alternate = function () {
  var self = this
  if (this.alternating === 'artist') {
    return this.entries.alternate(function (track) {
      return track.artist().toLowerCase()
    })
  } else if (this.alternating === 'album') {
    return this.refreshTracks().then(function () {
      return self.entries.alternate(function (track) {
        return track.album().toLowerCase()
      })
    })
  } else if (this.alternating === 'entry') {
    return this.entries.alternate(function (track) {
      return track.entry.toLowerCase()
    })
  }
}

/**
 * Remove duplicate entries.
 * @return {Promise|Playlist} - Itself.
 */
Playlist.prototype.dedup = function () {
  if (this.unique) {
    return this.entries.dedup()
  }
  return Promise.resolve(this)
}

/**
 * Dispatch all the entries in the playlist
 * and return the track listing.
 * @return {Promise | string} A newline-separated list
 * of Spotify URIs.
 */
Playlist.prototype.dispatch = function () {
  var self = this
  return this.fetchTracks().then(function () {
    return self.dedup()
  }).then(function () {
    return self.order()
  }).then(function () {
    return self.group()
  }).then(function () {
    return self.alternate()
  }).then(function () {
    return self.toString()
  })
}

/**
 * Fetch Last.fm metadata of each playlist entry.
 * @return {Promise | Queue} A queue of results.
 */
Playlist.prototype.fetchLastfm = function () {
  return this.entries.forEachPromise(function (entry) {
    return entry.fetchLastfm()
  })
}

/**
 * Dispatch the entries in the playlist.
 * @return {Promise} A Promise to perform the action.
 */
Playlist.prototype.fetchTracks = function () {
  var self = this
  return this.entries.dispatch().then(function (queue) {
    self.entries = queue.flatten()
  })
}

/**
 * Group the playlist entries.
 */
Playlist.prototype.group = function () {
  var self = this
  if (this.grouping === 'artist') {
    return this.entries.group(function (track) {
      return track.artist().toLowerCase()
    })
  } else if (this.grouping === 'album') {
    return this.refreshTracks().then(function () {
      return self.entries.group(function (track) {
        return track.album().toLowerCase()
      })
    })
  } else if (this.grouping === 'entry') {
    return this.entries.group(function (track) {
      return track.entry.toLowerCase()
    })
  }
}

/**
 * Order the playlist entries.
 * @return {Promise} A Promise to perform the action.
 */
Playlist.prototype.order = function () {
  var self = this
  if (this.ordering === 'popularity') {
    return this.refreshTracks().then(function () {
      self.entries.orderByPopularity()
    })
  } else if (this.ordering === 'lastfm') {
    return this.fetchLastfm().then(function () {
      self.entries.orderByLastfm()
    })
  }
}

/**
 * Print the playlist to the console.
 */
Playlist.prototype.print = function () {
  console.log(this.toString())
}

/**
 * Refresh the metadata of each playlist entry.
 * @return {Promise} A Promise to perform the action.
 */
Playlist.prototype.refreshTracks = function () {
  var self = this
  return this.entries.dispatch().then(function (result) {
    self.entries = result.flatten()
  })
}

/**
 * Convert the playlist to a string.
 * @return {string} A newline-separated list of Spotify URIs.
 */
Playlist.prototype.toString = function () {
  var result = ''
  var self = this
  this.entries.forEach(function (entry) {
    if (entry instanceof Track || entry instanceof Album) {
      if (entry instanceof Track) {
        console.log(entry.toString())
        console.log(entry.popularity() + ' (' + entry.lastfm() + ')')
      }
      if (self.csv) {
        var csvFormat = new CSV(entry)
        var csvLine = csvFormat.toString()
        result += csvLine + '\n'
      } else {
        var uri = entry.uri()
        if (uri !== '') {
          result += uri + '\n'
        }
      }
    }
  })
  return result.trim()
}

module.exports = Playlist