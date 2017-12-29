/*

 RFC 6458
 Sockets API Extensions for the Stream Control Transmission Protocol (SCTP)

 */

const Duplex = require('stream').Duplex
const ip = require('ip')
const Endpoint = require('./endpoint')

class Socket extends Duplex {
  constructor(options) {
    super(options)
    options = options || {}

    this.logger = options.logger
    if (this.logger && (typeof this.logger.log === 'function')) {
      this.log = (level, ...rest) => {
        this.logger.log(level, 'socket -', ...rest)
      }
    } else {
      this.log = () => {
      }
    }

    this.log('debug', 'start SCTP socket')
    this.writeBuffer = []
    this.sctp_sndrcvinfo = {
      protocol: options.protocol
    }

  }

  /*

   new net.Socket([options])
   Event: 'close'
   Event: 'connect'
   Event: 'data'
   Event: 'drain'
   Event: 'end'
   Event: 'error'
   Event: 'lookup'
   Event: 'timeout'
   socket.address()
   socket.bufferSize
   socket.bytesRead
   socket.bytesWritten
   socket.connect()
   socket.connect(options[, connectListener])
   socket.connect(path[, connectListener])
   socket.connect(port[, host][, connectListener])
   socket.connecting
   socket.destroy([exception])
   socket.destroyed
   socket.end([data][, encoding])
   socket.localAddress
   socket.localPort
   socket.pause()
   socket.ref()
   socket.remoteAddress
   socket.remoteFamily
   socket.remotePort
   socket.resume()
   socket.setEncoding([encoding])
   socket.setKeepAlive([enable][, initialDelay])
   socket.setNoDelay([noDelay])
   socket.setTimeout(timeout[, callback])
   socket.unref()
   socket.write(data[, encoding][, callback])

   Class: stream.Writable
   Event: 'close'
   Event: 'drain'
   Event: 'error'
   Event: 'finish'
   Event: 'pipe'
   Event: 'unpipe'
   writable.cork()
   writable.end([chunk][, encoding][, callback])
   writable.setDefaultEncoding(encoding)
   writable.uncork()
   writable.write(chunk[, encoding][, callback])
   writable.destroy([error])

   Class: stream.Readable
   Event: 'close'
   Event: 'data'
   Event: 'end'
   Event: 'error'
   Event: 'readable'
   readable.isPaused()
   readable.pause()
   readable.pipe(destination[, options])
   readable.read([size])
   readable.resume()
   readable.setEncoding(encoding)
   readable.unpipe([destination])
   readable.unshift(chunk)
   readable.wrap(stream)
   readable.destroy([error])

   */

  address() {
    return {
      port: this.localPort,
      address: this.localAddress,
      family: 'IPv4'
    }
  }

  connect(options, connectListener) {
    /*
     port: Port the client should connect to (Required).
     host: Host the client should connect to. Defaults to 'localhost'.
     localAddress: Local interface to bind to for network connections.
     localPort: Local port to bind to for network connections.
     family : Version of IP stack. Defaults to 4.
     hints: dns.lookup() hints. Defaults to 0.
     lookup : Custom lookup function. Defaults to dns.lookup.

     sctp_paddrparams
     */
    if (this.p2p) return
    this.p2p = true

    if (typeof options !== 'object') {
      throw new Error('options required')
    }
    this.log('debug', 'connect', options)

    function multi(address) {
      let addresses = Array.isArray(address) ? address : [address]
      addresses = addresses
        .filter((address) => ip.isV4Format(address))
      return addresses
    }

    let assocOptions = {
      streams: 1 // TODO: ?
    }
    assocOptions.remotePort = ~~options.port
    if (!assocOptions.remotePort) {
      throw new Error('port is required')
    }
    assocOptions.remoteAddress = options.host || '127.0.0.1'

    // todo multi
    let initOptions = {
      MIS: options.MIS,
      OS: options.OS
    }

    if (options.localAddress) {
      initOptions.localAddress = multi(options.localAddress)
    }
    if (options.localPort && ~~options.localPort) {
      initOptions.localPort = ~~options.localPort
    }

    this.log('debug', 'init & assoc options', initOptions, assocOptions)

    let endpoint = Endpoint.INITIALIZE(initOptions, this.logger)
    if (!endpoint) {
      this.emit('error', new Error('unable to allocate port ' + initOptions.localPort))
    }

    if (typeof connectListener === 'function') {
      this.on('connect', connectListener)
    }

    if (options.listen) {
      // associate & reject
      // TODO: consider abort immediately
      endpoint.on('COMMUNICATION UP', (association) => {
        if (association.remotePort === this.port && association.remoteAddress === this.host) {
          this.log('trace', 'remote peer2peer socket connected')
          this._construct(endpoint, association)
          this.emit('connect')
        } else {
          this.log('warn', 'remote peer2peer socket rejected port', association.remotePort)
          association.ABORT()
        }
      })
    } else {
      let association = endpoint.ASSOCIATE(assocOptions)
      // TODO: error on ASSOCIATE problems
      this._construct(endpoint, association)
    }
  }

  _final(callback) {
    // called by end()
    if (this._association) {
      this._association.SHUTDOWN(callback)
    }
  }


  // https://linux.die.net/man/7/sctp

  /*
   *   This option is used to both examine and set various association and
   *   endpoint parameters.
   struct sctp_assocparams {
   sctp_assoc_t    sasoc_assoc_id;
   __u16           sasoc_asocmaxrxt;
   __u16           sasoc_number_peer_destinations;
   __u32           sasoc_peer_rwnd;
   __u32           sasoc_local_rwnd;
   __u32           sasoc_cookie_life;
   };
   */

  SCTP_ASSOCINFO(options) {
    const params = ['valid_cookie_life']
    let endpoint = this._endpoint
    if (endpoint && typeof options === 'object') {
      params.forEach((key) => {
        if (options.hasOwnProperty(key)) {
          endpoint[key] = options[key]
        }
      })
    }
  }

  SCTP_DEFAULT_SEND_PARAM(options) {
    // should be assoc params
    Object.assign(this.sctp_sndrcvinfo, options)
  }

  /*
   * 7.1.13 Peer Address Parameters  (SCTP_PEER_ADDR_PARAMS)
   *
   *   Applications can enable or disable heartbeats for any peer address
   *   of an association, modify an address's heartbeat interval, force a
   *   heartbeat to be sent immediately, and adjust the address's maximum
   *   number of retransmissions sent before an address is considered
   *   unreachable. The following structure is used to access and modify an
   *   address's parameters:
   struct sctp_paddrparams {
   sctp_assoc_t            spp_assoc_id;
   struct sockaddr_storage spp_address;
   __u32                   spp_hbinterval;
   __u16                   spp_pathmaxrxt;
   __u32                   spp_pathmtu;
   __u32                   spp_sackdelay;
   __u32                   spp_flags;
   } __attribute__((packed, aligned(4)));
   */

  SCTP_PEER_ADDR_PARAMS(options) {
    // TODO: per peer address (if multihoming)

    const params = ['sack_timeout', 'sack_freq', 'hb_interval']
    let association = this._association
    if (association && typeof options === 'object') {
      params.forEach((key) => {
        if (options.hasOwnProperty(key)) {
          association[key] = options[key]
        }
      })
    }
  }

  _construct(endpoint, association) {
    // todo
    this.destroyed = false
    this.connecting = false
    this.bufferSize = 0 // this.writeBuffer.length
    this.bytesRead = 0
    this.bytesWritten = 0

    this._endpoint = endpoint
    this.localPort = endpoint.localPort
    this.localAddress = endpoint.localAddress

    this._association = association
    this.remotePort = association.remotePort
    this.remoteAddress = association.remoteAddress
    this.remoteFamily = 'IPv4'

    association.on('COMMUNICATION UP', () => {
      this.emit('connect')
      this.log('info', 'socket connected')
    })

    association.on('DATA ARRIVE', (stream_id) => {
      let buffer = association.RECEIVE(stream_id)
      if (buffer) {
        this.log('debug', '< DATA ARRIVE', buffer.length, buffer)
        this.push(buffer)
      }
    })

    association.on('SHUTDOWN COMPLETE', () => {
      this.log('debug', 'socket ended')
      if (this.p2p) {
        endpoint.DESTROY()
      }
      this.emit('end')
    })

    association.on('COMMUNICATION LOST', (event, reason) => {
      this.log('info', 'COMMUNICATION LOST', event, reason)
      if (this.p2p) {
        endpoint.DESTROY()
      }
      this.emit('close')
    })

    association.on('COMMUNICATION ERROR', () => {
      this.emit('error')
    })
  }

  _read(size) {
    // this function means that socket wants to get more data
  }

  _write(chunk, options, callback) {
    let association = this._association
    this.log('debug', '> write', this.sctp_sndrcvinfo, chunk)
    if (association) {
      association.SEND(chunk, this.sctp_sndrcvinfo, callback)
    } else {
      callback(new Error('no association established'))
    }
  }

  _destroy(err, callback) {
    // todo
    this.log('fatal', 'destroy')
    this._association.ABORT(err)
    callback()
  }

}


module.exports = Socket