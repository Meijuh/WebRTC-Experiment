/*
     2013, @muazkh � github.com/muaz-khan
     MIT License � https://webrtc-experiment.appspot.com/licence/
     Documentation � https://github.com/muaz-khan/WebRTC-Experiment/tree/master/RTCMultiConnection
*/

(function () {
    window.RTCMultiConnection = function (channel) {
        this.channel = channel;

        this.open = function (_channel) {
            if (_channel) self.channel = _channel;

            if (self.socket) self.socket.onDisconnect().remove();
            self.isInitiator = true;

            prepareInit(function () {
                init();
                captureUserMedia(rtcSession.initSession);
            });
        };

        this.connect = function (_channel) {
            if (_channel) self.channel = _channel;

            prepareInit(init);
        };

        this.join = joinSession;

        this.send = function (data, _channel) {
            if (!data) throw 'No file, data or text message to share.';
            if (data.size)
                FileSender.send({
                    file: data,
                    channel: rtcSession,
                    onFileSent: self.onFileSent,
                    onFileProgress: self.onFileProgress,
                    _channel: _channel
                });
            else
                TextSender.send({
                    text: data,
                    channel: rtcSession,
                    _channel: _channel
                });
        };

        var self = this, rtcSession, fileReceiver, textReceiver;

        function prepareInit(callback) {
            if (!self.openSignalingChannel) {
                if (typeof self.transmitRoomOnce == 'undefined') self.transmitRoomOnce = true;

                // for custom socket.io over node.js implementation � visit � https://github.com/muaz-khan/WebRTC-Experiment/blob/master/socketio-over-nodejs
                self.openSignalingChannel = function (config) {
                    channel = config.channel || self.channel || 'default-channel';
                    socket = new window.Firebase('https://' + (self.firebase || 'chat') + '.firebaseIO.com/' + channel);
                    socket.channel = channel;
                    socket.on('child_added', function (data) {
                        config.onmessage(data.val());
                    });

                    socket.send = function (data) {
                        this.push(data);
                    };

                    if (!self.socket) self.socket = socket;
                    if (channel != self.channel || (self.isInitiator && channel == self.channel)) socket.onDisconnect().remove();

                    if (config.onopen) setTimeout(config.onopen, 1);
                    return socket;
                };

                if (!window.Firebase) {
                    script = document.createElement('script');
                    script.src = 'https://cdn.firebase.com/v0/firebase.js';
                    script.onload = callback;
                    document.documentElement.appendChild(script);
                } else callback();
            } else callback();
        }

        function init() {
            if (self.config) return;

            self.config = {
                onNewSession: function (session) {
                    if (self.channel !== session.sessionid) return false;

                    if (!rtcSession) {
                        self._session = session;
                        return;
                    }

                    if (self.onNewSession) return self.onNewSession(session);

                    if (self.joinedARoom) return false;
                    self.joinedARoom = true;

                    return joinSession(session);
                },
                onmessage: function (e) {
                    if (!e.data.size) e.data = JSON.parse(e.data);

                    if (e.data.type === 'text')
                        textReceiver.receive({
                            data: e.data,
                            connection: self
                        });

                    else if (e.data.size || e.data.type === 'file')
                        fileReceiver.receive({
                            data: e.data,
                            connection: self
                        });
                    else self.onmessage(e);
                }
            };
            rtcSession = new RTCMultiSession(self);

            // bug: these two must be fixed. Must be able to receive many files concurrently.
            fileReceiver = new FileReceiver();
            textReceiver = new TextReceiver();

            if (self._session) self.config.onNewSession(self._session);
        }

        function joinSession(session) {
            if (!session || !session.userid || !session.sessionid) throw 'invalid data passed.';

            self.session = session.session;

            extra = self.extra || session.extra || {};

            if (session.oneway || session.data) rtcSession.joinSession(session, extra);
            else captureUserMedia(function () {
                rtcSession.joinSession(session, extra);
            });
        }

        function captureUserMedia(callback, _session) {
            var constraints;
            session = _session || self.session;

            log(JSON.stringify(session).replace(/{|}/g, '').replace(/,/g, '\n').replace(/:/g, ':\t'));

            if (self.dontAttachStream) return callback();

            self.attachStream = null;
            if (isData(session)) return callback();

            if (session.audio && !session.video) {
                constraints = {
                    audio: true,
                    video: false
                };
            }

            else if (session.screen) {
                video_constraints = {
                    mandatory: {
                        chromeMediaSource: 'screen'
                    },
                    optional: []
                };
                constraints = {
                    audio: false,
                    video: video_constraints
                };
            }

            else if (session.video && !session.audio) {
                video_constraints = {
                    mandatory: {},
                    optional: []
                };
                constraints = {
                    audio: false,
                    video: video_constraints
                };
            }
            mediaElement = document.createElement(session.audio && !session.video ? 'audio' : 'video');
            mediaConfig = {
                video: mediaElement,
                onsuccess: function (stream) {
                    self.attachStream = stream;

                    streamid = self.token();
                    self.onstream({
                        stream: stream,
                        streamid: streamid,
                        mediaElement: mediaElement,
                        blobURL: mediaElement.mozSrcObject || mediaElement.src,
                        type: 'local'
                    });

                    self.streams[streamid] = self._getStream({
                        stream: stream,
                        userid: self.userid,
                        streamid: streamid
                    });

                    if (callback) callback(stream);
                    mediaElement.autoplay = true;
                    mediaElement.controls = true;
                },
                onerror: function () {
                    if (session.audio && !session.video) throw 'Microphone access is denied.';
                    else if (session.screen) {
                        if (location.protocol === 'http:') throw '<https> is mandatory to capture screen.';
                        else throw 'Multi-capturing of screen is not allowed. Capturing process is denied.';
                    } else throw 'Webcam access is denied.';
                }
            };

            if (constraints) mediaConfig.constraints = constraints;
            return getUserMedia(mediaConfig);
        }
        this.captureUserMedia = captureUserMedia;

        this.leave = this.eject = function (userid) {
            rtcSession.leave(userid);
        };

        this.close = function () {
            self.autoCloseEntireSession = true;
            rtcSession.leave();
        };

        this.addStream = function (session, socket) {
            captureUserMedia(function (stream) {
                rtcSession.addStream({
                    stream: stream,
                    renegotiate: session,
                    socket: socket
                });
            }, session);
        };

        Defaulter(self);
    };

    function RTCMultiSession(root) {
        config = root.config;
        session = root.session;

        self = {};
        socketObjects = {};
        peers = {};
        sockets = [];

        self.userid = root.userid = root.userid || root.token();
        self.sessionid = root.channel;

        var channels = '--', isbroadcaster, isAcceptNewSession = true, RTCDataChannels = [];

        function newPrivateSocket(_config) {
            socketConfig = {
                channel: _config.channel,
                onmessage: socketResponse,
                onopen: function () {
                    if (isofferer && !peer) initPeer();

                    _config.socketIndex = socket.index = sockets.length;
                    socketObjects[socketConfig.channel] = socket;
                    sockets[_config.socketIndex] = socket;
                }
            };

            socketConfig.callback = function (_socket) {
                socket = _socket;
                socketConfig.onopen();
            };

            var socket = root.openSignalingChannel(socketConfig),
                isofferer = _config.isofferer, inner = {}, peer, mediaElement;

            peerConfig = {
                onopen: onChannelOpened,
                onmessage: function (event) {
                    config.onmessage({
                        data: event.data,
                        userid: _config.userid,
                        extra: _config.extra
                    });
                },
                onstream: function (stream) {
                    mediaElement = document.createElement(session.audio && !session.video ? 'audio' : 'video')
                    mediaElement[moz ? 'mozSrcObject' : 'src'] = moz ? stream : window.webkitURL.createObjectURL(stream);
                    mediaElement.autoplay = true;
                    mediaElement.controls = true;
                    mediaElement.play();

                    _config.stream = stream;
                    if (session.audio && !session.video) mediaElement.addEventListener('play', function () {
                        setTimeout(function () {
                            mediaElement.muted = false;
                            mediaElement.volume = 1;
                            afterRemoteStreamStartedFlowing();
                        }, 3000);
                    }, false);
                    else onRemoteStreamStartsFlowing();
                },

                onclose: function (e) {
                    e.extra = _config.extra;
                    e.userid = _config.userid;
                    root.onclose(e);
                },
                onerror: function (e) {
                    e.extra = _config.extra;
                    e.userid = _config.userid;
                    root.onerror(e);
                },

                attachStream: root.attachStream,
                iceServers: root.iceServers,
                bandwidth: root.bandwidth
            };

            function initPeer(offerSDP) {
                if (!offerSDP) peerConfig.onOfferSDP = function (sdp) {
                    sendsdp({
                        sdp: sdp,
                        socket: socket
                    });
                };
                else {
                    peerConfig.offerSDP = offerSDP;
                    peerConfig.onAnswerSDP = function (sdp) {
                        sendsdp({
                            sdp: sdp,
                            socket: socket
                        });
                    };
                }

                if (!session.data) peerConfig.onmessage = null;

                if (session.audio && !session.video) peerConfig.constraints = {
                    optional: [],
                    mandatory: {
                        OfferToReceiveAudio: true,
                        OfferToReceiveVideo: false
                    }
                };

                peer = RTCPeerConnection(peerConfig);
            }

            function onRemoteStreamStartsFlowing() {
                log('setTimeout(onRemoteStreamStartsFlowing, 300)');
                if (!(mediaElement.readyState <= HTMLMediaElement.HAVE_CURRENT_DATA || mediaElement.paused || mediaElement.currentTime <= 0)) {
                    afterRemoteStreamStartedFlowing();
                } else setTimeout(onRemoteStreamStartsFlowing, 300);
            }

            function afterRemoteStreamStartedFlowing() {
                streamid = root.token();
                _config.streamid = streamid;

                root.onstream({
                    mediaElement: mediaElement,

                    stream: _config.stream,
                    streamid: streamid,
                    session: session,

                    blobURL: mediaElement.mozSrcObject || mediaElement.src,
                    type: 'remote',

                    extra: _config.extra,
                    userid: _config.userid
                });

                onSessionOpened();
            }

            function onChannelOpened(channel) {
                RTCDataChannels[RTCDataChannels.length] = _config.channel = channel;

                root.onopen({
                    extra: _config.extra,
                    userid: _config.userid
                });

                onSessionOpened();
            }

            function onSessionOpened() {
                // user-id in <socket> object
                if (socket.userid == _config.userid) return;

                socket.userid = _config.userid;
                sockets[_config.socketIndex] = socket;

                // connection.peers['user-id'].addStream({audio:true})
                root.peers[_config.userid] = {
                    socket: socket,
                    peer: peer,
                    userid: _config.userid,
                    addStream: function (session) {
                        root.addStream(session, this.socket);
                    }
                };

                // connection.channels['user-id'].send(data);				
                root.channels[_config.userid] = {
                    channel: _config.channel,
                    send: function (data) {
                        root.send(data, this.channel);
                    }
                };

                // connection.streams['stream-id'].mute({audio:true})
                root.streams[_config.streamid] = root._getStream({
                    stream: _config.stream,
                    userid: _config.userid,
                    streamid: _config.streamid
                });

                // original conferencing infrastructure!
                if (!session.oneway && !session.broadcast && isbroadcaster && channels.split('--').length > 3)
                    defaultSocket.send({
                        newParticipant: socket.channel,
                        userid: self.userid,
                        extra: _config.extra || {}
                    });
            }

            function socketResponse(response) {
                if (response.userid == self.userid) return;

                if (response.sdp) {
                    _config.userid = response.userid;
                    _config.extra = response.extra;
                    _config.renegotiate = response.renegotiate;
                    sdpInvoker(response.sdp);
                }

                if (response.left) {
                    if (peer && peer.connection) {
                        peer.connection.close();
                        peer.connection = null;
                    }

                    if (response.closeEntireSession) leaveARoom();
                    else if (socket) {
                        socket.send({
                            left: true,
                            extra: root.extra,
                            userid: self.userid
                        });

                        if (sockets[_config.socketIndex]) delete sockets[_config.socketIndex];
                        if (socketObjects[socket.channel]) delete socketObjects[socket.channel];

                        socket = null;
                    }

                    root.onleave({
                        userid: response.userid,
                        extra: response.extra
                    });
                }

                if (response.playRoleOfBroadcaster)
                    setTimeout(function () {
                        self.userid = response.userid;
                        root.open({
                            extra: root.extra
                        });
                        sockets = sockets.swap();
                    }, 600);

                if (response.suggestRenegotiation) {
                    log('It is suggested to play role of renegotiator.');

                    if (response.renegotiate.removeStream)
                        createOffer();
                    else
                        root.captureUserMedia(function () {
                            peer.connection.addStream(root.attachStream);
                            createOffer();
                        }, response.renegotiate);

                    function createOffer() {
                        peer.recreateOffer(function (sdp) {
                            sendsdp({
                                sdp: sdp,
                                socket: socket,
                                renegotiate: response.renegotiate
                            });
                        });
                    }
                }
            }

            function sdpInvoker(sdp) {
                log(sdp.sdp);

                if (isofferer) return peer.addAnswerSDP(sdp);
                if (!_config.renegotiate) return initPeer(sdp);

                session = _config.renegotiate;
                if (session.oneway || session.removeStream || isData(session))
                    createAnswer();
                else {
                    if (_config.capturing) return;
                    _config.capturing = true;

                    root.captureUserMedia(function () {
                        _config.capturing = false;
                        peer.connection.addStream(root.attachStream);
                        createAnswer();
                    }, _config.renegotiate);
                }

                delete _config.renegotiate;
                function createAnswer() {
                    peer.recreateAnswer(sdp, function (_sdp) {
                        sendsdp({
                            sdp: _sdp,
                            socket: socket
                        });
                    });
                }
            }
        }

        function sendsdp(e) {
            e.socket.send({
                userid: self.userid,
                sdp: e.sdp,
                extra: root.extra,
                renegotiate: e.renegotiate ? e.renegotiate : false
            });
        }

        function onNewParticipant(channel, extra) {
            if (!channel || channels.indexOf(channel) != -1 || channel == self.userid) return;
            channels += channel + '--';

            new_channel = root.token();
            newPrivateSocket({
                channel: new_channel,
                closeSocket: true,
                extra: extra || {}
            });

            defaultSocket.send({
                participant: true,
                userid: self.userid,
                targetUser: channel,
                channel: new_channel,
                extra: root.extra
            });
        }

        function leaveARoom(channel) {
            alert = {
                left: true,
                extra: root.extra,
                userid: self.userid
            };

            if (isbroadcaster) {
                if (root.autoCloseEntireSession) alert.closeEntireSession = true;
                else sockets[0].send({
                    playRoleOfBroadcaster: true,
                    userid: self.userid
                });
            }

            if (!channel) {
                length = sockets.length;
                for (var i = 0; i < length; i++) {
                    socket = sockets[i];
                    if (socket) {
                        socket.send(alert);
                        if (socketObjects[socket.channel]) delete socketObjects[socket.channel];
                        delete sockets[i];
                    }
                }
            }

            // eject a specific user!
            if (channel) {
                socket = socketObjects[channel];
                if (socket) {
                    socket.send(alert);
                    if (sockets[socket.index]) delete sockets[socket.index];
                    delete socketObjects[channel];
                }
            }
            sockets = sockets.swap();
        }

        window.onunload = function () {
            leaveARoom();
        };

        (function () {
            var anchors = document.querySelectorAll('a'), length = anchors.length;
            for (var i = 0; i < length; i++) {
                a = anchors[i];
                if (a.href.indexOf('#') !== 0 && a.getAttribute('target') != '_blank')
                    a.onclick = function () {
                        leaveARoom();
                    };
            }
        })();

        var that = this,
            defaultSocket = root.openSignalingChannel({
                onmessage: function (response) {
                    if (response.userid == self.userid) return;
                    if (isAcceptNewSession && response.sessionid && response.userid) config.onNewSession(response);
                    if (response.newParticipant && self.joinedARoom && self.broadcasterid === response.userid) onNewParticipant(response.newParticipant, response.extra);
                    if (response.userid && response.targetUser == self.userid && response.participant && channels.indexOf(response.userid) == -1) {
                        channels += response.userid + '--';
                        newPrivateSocket({
                            isofferer: true,
                            channel: response.channel || response.userid,
                            closeSocket: true,
                            extra: response.extra
                        });
                    }
                },
                callback: function (socket) {
                    defaultSocket = socket;
                }
            });

        this.initSession = function () {
            isbroadcaster = true;
            isAcceptNewSession = false;

            (function transmit() {
                defaultSocket && defaultSocket.send({
                    sessionid: self.sessionid,
                    userid: self.userid,
                    session: session,
                    extra: root.extra
                });

                if (!root.transmitRoomOnce && !that.leaving) setTimeout(transmit, root.interval || 3000);
            })();
        };

        this.joinSession = function (_config) {
            _config = _config || {};

            session = _config.session;

            self.joinedARoom = true;

            if (_config.sessionid) self.sessionid = _config.sessionid;
            isAcceptNewSession = false;

            newPrivateSocket({
                channel: self.userid,
                extra: _config.extra
            });

            defaultSocket.send({
                participant: true,
                userid: self.userid,
                targetUser: _config.userid,
                extra: root.extra
            });

            self.broadcasterid = _config.userid;
        };

        this.send = function (message, _channel) {
            var _channels = RTCDataChannels,
                    data, length = _channels.length;
            if (!length) return;

            if (moz && message.file) data = message.file;
            else data = JSON.stringify(message);

            if (_channel) _channel.send(data);
            else for (var i = 0; i < length; i++) _channels[i].send(data);
        };

        this.leave = function (userid) {
            leaveARoom(userid);

            if (!userid) {
                self.joinedARoom = isbroadcaster = false;
                isAcceptNewSession = true;
            }
        };

        this.addStream = function (e) {
            session = e.renegotiate;

            if (e.socket) addStream(e.socket);
            else for (var i = 0; i < sockets.length; i++) addStream(sockets[i]);

            function addStream(socket) {
                peer = root.peers[socket.userid];
                if (!peer) throw 'No such peer exists.';
                peer = peer.peer;

                log(peer);

                // if offerer; renegotiate
                if (peer.connection.localDescription.type == 'offer') {
                    if (!session.removeStream && (session.audio || session.video)) peer.connection.addStream(e.stream);
                    peer.recreateOffer(function (sdp) {
                        log(sdp);
                        sendsdp({
                            sdp: sdp,
                            socket: socket,
                            renegotiate: session
                        });
                    });
                }
                else {
                    log('no way, it is too bad!');
                    // otherwise; suggest other user to play role of renegotiator
                    socket.send({
                        userid: self.userid,
                        renegotiate: e.renegotiate,
                        suggestRenegotiation: true
                    });
                }
            }
        };
    }

    FileSender = {
        send: function (config) {
            channel = config.channel;
            file = config.file;
            _channel = config._channel;

            if (moz) {
                channel.send({
                    fileName: file.name,
                    type: 'file'
                }, _channel);

                channel.send({
                    file: file
                }, _channel);

                config.onFileSent(file);
            }

            if (!moz) {
                reader = new window.FileReader();
                reader.readAsDataURL(file);
                reader.onload = onReadAsDataURL;
            }

            var packetSize = 1000 /* chars */,
                textToTransfer = '',
                numberOfPackets = 0,
                packets = 0;

            function onReadAsDataURL(event, text) {
                data = {
                    type: 'file'
                };

                if (event) {
                    text = event.target.result;
                    numberOfPackets = packets = data.packets = parseInt(text.length / packetSize);
                }

                config.onFileProgress({
                    remaining: packets--,
                    length: numberOfPackets,
                    sent: numberOfPackets - packets
                });

                if (text.length > packetSize) data.message = text.slice(0, packetSize);
                else {
                    data.message = text;
                    data.last = true;
                    data.name = file.name;

                    config.onFileSent(file);
                }

                channel.send(data, _channel);

                textToTransfer = text.slice(data.message.length);

                if (textToTransfer.length)
                    setTimeout(function () {
                        onReadAsDataURL(null, textToTransfer);
                    }, 500);
            }
        }
    };

    function FileReceiver() {
        var content = [],
            fileName = '',
            packets = 0,
            numberOfPackets = 0;

        this.receive = function (e) {
            data = e.data;
            connection = e.connection;

            if (moz) {
                if (data.fileName) fileName = data.fileName;

                if (data.size) {
                    reader = new window.FileReader();
                    reader.readAsDataURL(data);
                    reader.onload = function (event) {
                        FileSaver.SaveToDisk({
                            fileURL: event.target.result,
                            fileName: fileName
                        });
                        connection.onFileReceived(fileName);
                    };
                }
            }

            if (!moz) {
                if (data.packets) numberOfPackets = packets = parseInt(data.packets);

                if (connection.onFileProgress)
                    connection.onFileProgress({
                        remaining: packets--,
                        length: numberOfPackets,
                        received: numberOfPackets - packets
                    });

                content.push(data.message);

                if (data.last) {
                    FileSaver.SaveToDisk({
                        fileURL: content.join(''),
                        fileName: data.name
                    });
                    connection.onFileReceived(data.name);
                    content = [];
                }
            }
        };
    }

    TextSender = {
        send: function (config) {
            var channel = config.channel,
                initialText = config.text,
                packetSize = 1000 /* chars */,
                textToTransfer = '',
				_channel = config._channel;


            if (typeof initialText !== 'string') initialText = JSON.stringify(initialText);

            if (moz || initialText.length <= packetSize) channel.send(config.text, _channel);
            else sendText(initialText);

            function sendText(textMessage, text) {
                data = {
                    type: 'text'
                };

                if (textMessage) {
                    text = textMessage;
                    data.packets = parseInt(text.length / packetSize);
                }

                if (text.length > packetSize) data.message = text.slice(0, packetSize);
                else {
                    data.message = text;
                    data.last = true;
                }

                channel.send(data, _channel);

                textToTransfer = text.slice(data.message.length);

                if (textToTransfer.length)
                    setTimeout(function () {
                        sendText(null, textToTransfer);
                    }, 500);
            }
        }
    };

    function TextReceiver() {
        content = [];

        function receive(e) {
            data = e.data;
            connection = e.connection;

            content.push(data.message);
            if (data.last) {
                connection.onmessage(content.join(''));
                content = [];
            }
        }

        return {
            receive: receive
        };
    }

    FileSaver = {
        SaveToDisk: function (e) {
            save = document.createElement('a');
            save.href = e.fileURL;
            save.target = '_blank';
            save.download = e.fileName || e.fileURL;

            evt = document.createEvent('MouseEvents');
            evt.initMouseEvent('click', true, true, window, 1, 0, 0, 0, 0, false, false, false, false, 0, null);

            save.dispatchEvent(evt);

            (window.URL || window.webkitURL).revokeObjectURL(save.href);
        }
    };

    window.MediaStream = window.MediaStream || window.webkitMediaStream;

    window.moz = !!navigator.mozGetUserMedia;
    var RTCPeerConnection = function (options) {
        var w = window,
            PeerConnection = w.mozRTCPeerConnection || w.webkitRTCPeerConnection,
            SessionDescription = w.mozRTCSessionDescription || w.RTCSessionDescription;

        STUN = {
            url: !moz ? 'stun:stun.l.google.com:19302' : 'stun:23.21.150.121'
        };

        TURN = {
            url: 'turn:webrtc%40live.com@numb.viagenie.ca',
            credential: 'muazkh'
        };

        iceServers = {
            iceServers: options.iceServers || [STUN]
        };

        if (!moz && !options.iceServers) iceServers.iceServers = [TURN, STUN];

        optional = {
            optional: []
        };

        if (!moz) {
            optional.optional = [{
                DtlsSrtpKeyAgreement: true
            }];

            if (options.onmessage) optional.optional = [{
                RtpDataChannels: true
            }];
        }

        var peer = new PeerConnection(iceServers, optional);

        openOffererChannel();

        peer.onicecandidate = function (event) {
            if (!event.candidate) returnSDP();
            else log('injecting ice in sdp:', event.candidate);
        };

        peer.ongatheringchange = function (event) {
            if (event.currentTarget && event.currentTarget.iceGatheringState === 'complete') returnSDP();
        };

        function returnSDP() {
            log('sharing localDescription', peer.localDescription);

            if (options.onOfferSDP) options.onOfferSDP(peer.localDescription);
            else options.onAnswerSDP(peer.localDescription);
        }

        if (options.attachStream) peer.addStream(options.attachStream);
        peer.onaddstream = function (event) {
            log('on:add:stream', event.stream);

            if (!event || !options.onstream) return;
            options.onstream(event.stream);
        };

        constraints = options.constraints || {
            optional: [],
            mandatory: {
                OfferToReceiveAudio: true,
                OfferToReceiveVideo: true
            }
        };

        if (!moz && options.onmessage && !options.attachStream) constraints = {
            optional: [],
            mandatory: {
                OfferToReceiveAudio: false,
                OfferToReceiveVideo: false
            }
        };

        if (moz && !options.onmessage) constraints.mandatory.MozDontOfferDataChannel = true;

        function createOffer() {
            if (!options.onOfferSDP) return;

            peer.createOffer(function (sessionDescription) {
                sessionDescription.sdp = setBandwidth(sessionDescription.sdp);
                peer.setLocalDescription(sessionDescription);
            }, null, constraints);
        }

        function createAnswer() {
            if (!options.onAnswerSDP) return;

            options.offerSDP = new SessionDescription(options.offerSDP);
            peer.setRemoteDescription(options.offerSDP);

            peer.createAnswer(function (sessionDescription) {
                sessionDescription.sdp = setBandwidth(sessionDescription.sdp);
                peer.setLocalDescription(sessionDescription);
            }, null, constraints);
        }

        if ((options.onmessage && !moz) || !options.onmessage) {
            createOffer();
            createAnswer();
        }

        bandwidth = options.bandwidth;
        function setBandwidth(sdp) {
            sdp = sdp.replace(/m=audio([^\r\n]+)/g, '$1\r\nb=AS:' + (bandwidth.audio || 50))
            sdp = sdp.replace(/m=video([^\r\n]+)/g, '$1\r\nb=AS:' + (bandwidth.video || 256))
            return sdp;
        }

        var channel;

        function openOffererChannel() {
            if (!options.onmessage || (moz && !options.onOfferSDP)) return;

            _openOffererChannel();

            if (moz && !options.attachStream) {
                navigator.mozGetUserMedia({
                    audio: true,
                    fake: true
                }, function (stream) {
                    peer.addStream(stream);
                    createOffer();
                }, useless);
            }
        }

        function _openOffererChannel() {
            channel = peer.createDataChannel(
                options.channel || 'RTCDataChannel',
                moz ? {} : {
                    reliable: false
                });

            if (moz) channel.binaryType = 'blob';
            setChannelEvents();
        }

        function setChannelEvents() {
            channel.onmessage = options.onmessage;
            channel.onopen = function () {
                options.onopen(channel);
            };
            channel.onclose = options.onclose;
            channel.onerror = options.onerror;
        }

        if (options.onAnswerSDP && moz) openAnswererChannel();

        function openAnswererChannel() {
            peer.ondatachannel = function (event) {
                channel = event.channel;
                channel.binaryType = 'blob';
                setChannelEvents();
            };

            if (moz && !options.attachStream) {
                navigator.mozGetUserMedia({
                    audio: true,
                    fake: true
                }, function (stream) {
                    peer.addStream(stream);
                    createAnswer();
                }, useless);
            }
        }

        function useless() { }

        return {
            connection: peer,
            addAnswerSDP: function (sdp) {
                peer.setRemoteDescription(new SessionDescription(sdp));
            },
            recreateAnswer: function (sdp, callback) {
                options.onAnswerSDP = callback;
                options.offerSDP = sdp;
                createAnswer();
            },
            recreateOffer: function (callback) {
                options.onOfferSDP = callback;
                createOffer();
            }
        };
    };

    video_constraints = {
        mandatory: {},
        optional: []
    };

    function getUserMedia(options) {
        var n = navigator, media;
        n.getMedia = n.webkitGetUserMedia || n.mozGetUserMedia;
        n.getMedia(options.constraints || {
            audio: true,
            video: video_constraints
        }, streaming, options.onerror || function (e) {
            console.error(e);
        });

        function streaming(stream) {
            video = options.video;
            if (video) {
                video[moz ? 'mozSrcObject' : 'src'] = moz ? stream : window.webkitURL.createObjectURL(stream);
                video.play();
            }
            options.onsuccess(stream);
            media = stream;
        }

        return media;
    }

    function isData(session) {
        return !session.audio && !session.video && !session.screen && session.data;
    }

    Array.prototype.swap = function () {
        var swapped = [], arr = this, length = arr.length;
        for (var i = 0; i < length; i++) if (arr[i]) swapped[swapped.length] = arr[i];
        return swapped;
    };

    function log() {
        console.debug(arguments)
    }

    function Defaulter(self) {
        self.onmessage = function (e) {
            log(e.userid, 'posted', e.data);
        };

        self.onopen = function (e) {
            log('Data connection is opened between you and', e.userid);
        };

        self.onerror = function (e) {
            console.error('Error in data connection between you and', e.userid, e);
        };

        self.onclose = function (e) {
            console.warn('Data connection between you and', e.userid, 'is closed.', e);
        };

        self.onFileReceived = function (fileName) {
            log('File <', fileName, '> received successfully.');
        };

        self.onFileSent = function (file) {
            log('File <', file.name, '> sent successfully.');
        };

        self.onFileProgress = function (packets) {
            log('<', packets.remaining, '> items remaining.');
        };

        self.onremovestream = function (e) {
            log(e.stream, 'is removed.');
        };

        self.onstream = function (stream) {
            log('stream:', stream);
        };

        self.onleave = function (e) {
            log(e.userid, 'left!');
        };

        self.peers = {};
        self.streams = {};
        self.channels = {};
        self.extra = {};

        self.session = {
            audio: true,
            video: true,
            data: true
        };

        self.bandwidth = {
            audio: 50,
            video: 256
        };

        self._getStream = function (e) {
            return {
                stream: e.stream,
                userid: e.userid,
                streamid: e.streamid,
                mute: function (session) {
                    this._private(session, true);
                },
                unmute: function () {
                    this._private(session, false);
                },
                _private: function (session, enabled) {
                    stream = this.stream;

                    if (session.audio) {
                        audioTracks = stream.getAudioTracks()[0];
                        if (audioTracks) audioTracks.enabled = !enabled;
                    }

                    if (session.video) {
                        videoTracks = stream.getVideoTracks()[0];
                        if (videoTracks) videoTracks.enabled = !enabled;
                    }
                },
                removeStream: function () {
                    peer = self.peers[this.userid];
                    if (!peer) throw 'No such peer exists. Invalid user-id: ' + this.userid;

                    socket = peer.socket;
                    peer = peer.peer;

                    peer.connection.removeStream(this.stream);
                    rtcSession.addStream({
                        socket: socket,
                        renegotiate: {
                            removeStream: true
                        }
                    });

                    self.onremovestream({
                        stream: this.stream,
                        streamid: this.streamid,
                        userid: this.userid
                    });

                    delete self.streams[this.userid];
                }
            };
        };

        self.token = function () {
            return (Math.random() * new Date().getTime()).toString(36).toUpperCase().replace(/\./g, '-');
        };
    }
})();