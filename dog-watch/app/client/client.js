var primaryPeerConnection = null;
var backupPeerConnection = null;
var vfdIntervalId = null;
var state = 0;

window.onbeforeunload = function() {
  if (primaryPeerConnection !== null) {
    primaryPeerConnection.close();
  }
};

function showFullscreenMessage() {
  if (state === 1) {
    var elem = document.getElementById('fullscreen-info-1');
  } else {
    var elem = document.getElementById('fullscreen-info-2');
  }
  elem.style.display = 'initial';
  setTimeout(function () {
    elem.style.display = 'none';
  }, 2000);
}

function attachStreamToVideoElement(pc, videoElem){
  console.log('Attaching stream...');
  var srcStream = new MediaStream();
  srcStream.addTrack(pc.getReceivers()[0].track);
  videoElem.srcObject = srcStream;
}

function peerConnectionGood(pc) {
  return ((pc.iceConnectionState === 'connected' || pc.iceConnectionState === 'completed'));
}

function peerConnectionBad(pc) {
  return ((pc.iceConnectionState === 'disconnected' || pc.iceConnectionState === 'failed' || pc.iceConnectionState === 'closed'));
}

function hideAllContainers() {
    document.getElementById('spinner-container').style.display = 'none';
    document.getElementById('video-container').style.display = 'none';
    document.getElementById('fail-container').style.display = 'none';
    document.getElementById('mjpeg-container').style.display = 'none';
}

function showContainer(kind) {
  hideAllContainers();
  if (kind === 'video') {
    document.getElementById('video-container').style.display = 'block';
  } else if (kind === 'fail') {
    document.getElementById('fail-container').style.display = 'initial';
  } else if (kind === 'mjpeg') {
    document.getElementById('mjpeg-container').style.display = 'block';
  } else {
    console.error('No container that is kind of: ' + kind);
  }
}

function createNewPeerConnection() {
  var pc = new RTCPeerConnection(config);
  var isVideoAttached = false;
  new Promise(function (resolve, reject) {
    function mainIceListener() {
      console.warn(pc.iceConnectionState);
      if  (peerConnectionBad(pc)){
        if (state === 0) {
          //this means webrtc connection is not possible
          startMJPEG();
        }
        if (state !== 2) {
          showContainer('fail');
        }
      }
      if (peerConnectionGood(pc)) {
        document.getElementById('webrtc').style.display = 'initial';
        if (!isVideoAttached) {
          if (state === 0) {
            state = 1;
          }
          isVideoAttached = true;
          attachStreamToVideoElement(pc, document.getElementById('video'));
          cleanup();
          startVideoFreezeDetection(pc);
        }
        showContainer('video');
      }
    }
    pc.addEventListener('iceconnectionstatechange', mainIceListener);
    resolve();
  }).then(function () {
    pc.addTransceiver('video', {direction: 'recvonly'});
    return pc.createOffer()
  }).then(function(offer) {
    return pc.setLocalDescription(offer);
  }).then(function() {
    // wait for ICE gathering to complete
    return new Promise(function(resolve) {
      if (pc.iceGatheringState === 'complete') {
        resolve();
      } else {
        function checkState() {
          if (pc.iceGatheringState === 'complete') {
            pc.removeEventListener('icegatheringstatechange', checkState);
            resolve();
          }
        }
        pc.addEventListener('icegatheringstatechange', checkState);
      }
    });
  }).then(function() {
    var offer = pc.localDescription;
    console.log('Offer SDP');
    console.log(offer.sdp);
    return fetch('/offer', {
      body: JSON.stringify({
        sdp: offer.sdp,
        type: offer.type,
      }),
      headers: {
        'Content-Type': 'application/json'
      },
      method: 'POST'
    });
  }).then(function(response) {
    return response.json();
  }).then(function(answer) {
    console.log('Answer SDP');
    console.log(answer.sdp);
    return pc.setRemoteDescription(answer);
  }).catch(function(e){
    console.error(e);
    console.log('Unexpected Error: Starting MJPEG stream.')
    startMJPEG();
  });
  return pc
}

function supportsFullscreen() {
  return (document.body.mozRequestFullScreen || document.body.webkitRequestFullScreen || document.body.requestFullScreen);
}

function requestFullscreen(element) {
  return ((element.mozRequestFullScreen && element.mozRequestFullScreen()) ||
  (element.webkitRequestFullScreen && element.webkitRequestFullScreen()) ||
  (element.requestFullScreen && element.requestFullScreen()));
}

function fullscreen(elem) {
  if (elem === 1) {
    var video = document.getElementById('video');
  } else {
    var video = document.getElementById('mjpeg');
  }
  if (supportsFullscreen()) {
    setTimeout(requestFullscreen(video), 100);
  }
}

// Use on firefox
function getCurrentFrame() {
    var canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    var canvasContext = canvas.getContext("2d");
    canvasContext.drawImage(video, 0, 0);
    return canvas.toDataURL('image/png');
}

function isVideoFrozen(pc) {
  var previousFrame;
  var ignoreFirst = true;
  vfdIntervalId = setInterval(function() {
    if (peerConnectionGood(pc) && video.currentTime > 0 && getCurrentFrame() === previousFrame) {
      if (ignoreFirst) {
        ignoreFirst = false;
        return
      }
      console.warn("Video freeze detected using frames!!!");
      reconnect();
    } else {
      previousFrame = getCurrentFrame();
    }
  }, 3000);
}

// Use on Chrome
function checkVideoFreeze(pc) {
  var previousPlaybackTime;
  vfdIntervalId = setInterval(function() {
    if (peerConnectionGood(pc) && previousPlaybackTime === video.currentTime && video.currentTime !== 0) {
      console.warn("Video freeze detected!!!");
      reconnect();
    } else {
      previousPlaybackTime = video.currentTime;
    }
  }, 3000);
}

function startVideoFreezeDetection(pc) {
  stopVideoFreezeDetection();
  if (navigator.userAgent.toLowerCase().indexOf('firefox') > -1) {
    isVideoFrozen(pc);
  } else {
    checkVideoFreeze(pc);
  }
}

function stopVideoFreezeDetection() {
  if (vfdIntervalId !== null) {
    console.log('Stopping Current Video Freeze Detector');
    clearInterval(vfdIntervalId);
  }
}

function cleanup() {
  if (backupPeerConnection !== null) {
    console.log('Cleaning Up...')
    var tmp = primaryPeerConnection;
    primaryPeerConnection = backupPeerConnection;
    backupPeerConnection = tmp;
    backupPeerConnection.close();
    backupPeerConnection = null;
    var thisInterval = setInterval(function (){
      if (peerConnectionGood(primaryPeerConnection) && backupPeerConnection === null) {
        showContainer('video');
        clearInterval(thisInterval);
      }
    }, 100);
  }
}

function reconnect() {
  console.log('Reconnecting');
  backupPeerConnection = createNewPeerConnection();
}

function startMJPEG() {
  if (state !== 3) {
    primaryPeerConnection.close();
    primaryPeerConnection = null;
  }
  document.getElementById('vpn').style.display = 'initial';
  console.warn('WebRTC does not work! Starting MJPEG streaming.')
  state = 2;

  var canvas = document.createElement("canvas");
  var ctx = canvas.getContext('2d');
  document.getElementById('mjpeg').appendChild(canvas);

  var mjpeg = new Image();
  mjpeg.id = 'mjpeg-image';
  mjpeg.src = '/mjpeg';
  mjpeg.style.visibility = 'hidden';
  mjpeg.style.position = 'absolute';
  document.getElementById('mjpeg').appendChild(mjpeg);

  mjpeg.onload = function() {
    canvas.style.width = mjpeg.width;
    canvas.style.height = mjpeg.height;
    canvas.width = mjpeg.width;
    canvas.height = mjpeg.height;
    var draw = setInterval(function() {
      try {
        ctx.drawImage(mjpeg, 0, 0);
      } catch (error) {
        console.error(error);
        console.warn('Stopping canvas draw.');
        clearInterval(draw);
        showContainer('fail');
      }
    }, 50);
  }

  showContainer('mjpeg');
}

var isSafari = !!navigator.userAgent.match(/Version\/[\d\.]+.*Safari/);
var iOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
var safariOnIos = isSafari && iOS;
if (window.navigator.userAgent.indexOf("Edge") > -1  || safariOnIos) {
  //state 3 means the client is a Microsoft Edge or Safari on iOS
  state = 3;
  startMJPEG();
} else {
  var config = null;
  fetch('/ice-config').then(function(response) {
    return response.json();
  }).then(function(configData){
    config = configData;
    primaryPeerConnection = createNewPeerConnection();
  }).catch(function(e){
    console.error('Error while getting the ICE server configuration');
    console.error(e);
    state = 3;
    startMJPEG();
  });
}

/*
 * START AUDIO RECORDING STUFF
 */

//webkitURL is deprecated but nevertheless
URL = window.URL || window.webkitURL;

var gumStream; 						//stream from getUserMedia()
var rec; 							//Recorder.js object
var input; 							//MediaStreamAudioSourceNode we'll be recording

// shim for AudioContext when it's not avb. 
var AudioContext = window.AudioContext || window.webkitAudioContext;
var audioContext //audio context to help us record

var recordButton = document.getElementById("recordButton");
var stopButton = document.getElementById("stopButton");
var pauseButton = document.getElementById("pauseButton");

//add events to those 2 buttons
recordButton.addEventListener("click", startRecording);
stopButton.addEventListener("click", stopRecording);
pauseButton.addEventListener("click", pauseRecording);

function startRecording() {
	console.log("recordButton clicked");

	/*
		Simple constraints object, for more advanced audio features see
		https://addpipe.com/blog/audio-constraints-getusermedia/
	*/
    
    var constraints = { audio: true, video:false }

 	/*
    	Disable the record button until we get a success or fail from getUserMedia() 
	*/

	recordButton.disabled = true;
	console.log("recordButton clicked");
	/*
    	We're using the standard promise based getUserMedia() 
    	https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia
	*/

    navigator.mediaDevices.getUserMedia(constraints).then(function(stream) {
        console.log("getUserMedia() success, stream created, initializing Recorder.js ...");

	console.log("Debug 1");
		/*
			create an audio context after getUserMedia is called
			sampleRate might change after getUserMedia is called, like it does on macOS when recording through AirPods
			the sampleRate defaults to the one set in your OS for your playback device
		*/
		audioContext = new AudioContext();

	console.log("Debug 2");
		/*  assign to gumStream for later use  */
		gumStream = stream;
		
	console.log("Debug 3");
		/* use the stream */
		input = audioContext.createMediaStreamSource(stream);

		/* 
			Create the Recorder object and configure to record mono sound (1 channel)
			Recording 2 channels  will double the file size
		*/
		rec = new Recorder(input,{numChannels:1})

	console.log("Debug 4");
		//start the recording process
		rec.record()

		console.log("Recording started");
        stopButton.disabled = false;
        pauseButton.disabled = false;


	}).catch(function(err) {
	  	//enable the record button if getUserMedia() fails
		console.log("Error: ", err);
        recordButton.disabled = false;
    	stopButton.disabled = true;
    	pauseButton.disabled = true
	});
}

function pauseRecording(){
	console.log("pauseButton clicked rec.recording=",rec.recording );
	if (rec.recording){
		//pause
		rec.stop();
		pauseButton.innerHTML="Resume";
	}else{
		//resume
		rec.record()
		pauseButton.innerHTML="Pause";

	}
}

function stopRecording() {
	console.log("stopButton clicked");

	//disable the stop button, enable the record too allow for new recordings
	stopButton.disabled = true;
	recordButton.disabled = false;
	pauseButton.disabled = true;

	//reset button just in case the recording is stopped while paused
	pauseButton.innerHTML="Pause";
	
	//tell the recorder to stop the recording
	rec.stop();

	//stop microphone access
	gumStream.getAudioTracks()[0].stop();

	//create the wav blob and pass it on to createDownloadLink
	rec.exportWAV(createDownloadLink);
}

function createDownloadLink(blob) {

    // MY OWN CODE
    var form = new FormData();
    form.append('fname', 'test.wav');
    form.append('data', blob);

    $.ajax({
          type: 'POST',
          url: '/play-audio',
          data: form, // Our pretty new form
          cache: false,
          processData: false, // tell jQuery not to process the data
          contentType: false // tell jQuery not to set contentType
    }).done(function(data) {
          console.log(data);
    });
}

/*
 * END AUDIO RECORDING STUFF
 */
