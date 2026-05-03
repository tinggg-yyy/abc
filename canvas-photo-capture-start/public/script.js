let socket;
if (
  location.hostname.toLowerCase().startsWith("browsercircus") ||
  location.hostname.toLowerCase().startsWith("www")
) {
  socket = io({ path: "/canvas-photo/socket.io" }); // yields '/leon/port-4100/socket.io' or '/socket.io'
} else {
  socket = io();
}

let video;
let snapped = false;
let canvas;
let camSound = document.querySelector("#camSound");
let sendButton = document.querySelector("#sendButton");
let captureButton = document.querySelector("#captureButton");

function setup() {
  canvas = createCanvas(480, 640);
  canvas.parent("canvas-wrapper");

  // the canvas contains 480 x 640 pixels
  // that also defines the resolution of the captured images
  // but we can make it appear smaller on the actual website:
  let canvasDisplayHeight = window.innerHeight / 3;
  canvas.elt.style.height = canvasDisplayHeight + "px";
  let canvasDisplayWidth = canvasDisplayHeight * (480 / 640);
  canvas.elt.style.width = canvasDisplayWidth + "px";

  // Create a video capture (aka webcam input)
  // video = createCapture(VIDEO);
  video = createCapture({
    video: { facingMode: "environment" },
    audio: false, // 👈 important
  });

  // Specify the resolution of the webcam input (too high and you may notice performance issues, especially if you're extracting info from it or adding filters)
  video.size(480, 640);

  // In some browsers, you may notice that a second video appears onscreen! That's because p5js actually creates a <video> html element, which then is piped into the canvas – the added command below ensures we don't see it :)
  video.hide();
  background(0);
}

function draw() {
  // we draw no background here
  // so the the video 'freezes' when we snap

  // before we snap the images refreshes every frame
  if (snapped == false) {
    // Display the video just like an image!
    image(video, 0, 0, 480, 640);
  }

  // fill(255)
  // text(width + " " + video.width + " " + video.height, 20, 20)
}

// pressing the CAPTURE BUTTON:
captureButton.addEventListener("click", function () {
  if (snapped == false) {
    snapped = true;
    sendButton.style.visibility = "visible";
    captureButton.innerText = "Try Again";
    captureButton.style.width = "30%";
    captureButton.style.backgroundColor = "rgb(255, 191, 191)";

    camSound.play();
  } else {
    // CLICK OF "Try Again" BUTTON
    resetCamera();
  }
});

// pressing the send to server button
sendButton.addEventListener("click", function () {
  // turn canvas into png image data
  canvas.elt.toBlob(sendImageToServer, "image/png");
});

// socket handling incoming photos:
// array of photos:
socket.on("historic-photos", function (historicalData) {
  for (historicalPhoto of historicalData) {
    console.log(historicalPhoto);
    prependPhoto(historicalPhoto.url);
  }
});

// individual photo:
socket.on("new-photo", function (photoData) {
  console.log(photoData);
  prependPhoto(photoData);
});

// FUNCTIONS:

function resetCamera() {
  snapped = false;
  sendButton.style.visibility = "hidden";
  captureButton.innerText = "SNAP!";
  captureButton.style.width = "50%";
  captureButton.style.backgroundColor = "initial";
}

function sendImageToServer(blob) {
  console.log(blob);
  fetch("upload-photo", {
    method: "POST",
    headers: { "Content-Type": "image/png" }, // or jpg
    body: blob,
  }).then((data) => {
    console.log(data.status);
    resetCamera();
  });
}

function prependPhoto(URL) {
  // console.log(data, socket.id);
  let album = document.querySelector("#album");
  let img = document.createElement("img");
  let images = album.querySelector("#images");
  img.src = URL;
  images.prepend(img);
}
