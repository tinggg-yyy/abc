let socket;
if (
  location.hostname.toLowerCase().startsWith("browsercircus") ||
  location.hostname.toLowerCase().startsWith("www")
) {
  socket = io({ path: "/YOUR-NAME/YOUR-PORT/socket.io" }); // e.g. '/leon/port-4100/socket.io' or '/socket.io'
} else {
  socket = io();
}

let readyButton = document.querySelector("#ready");
let mainWrapper = document.querySelector(".main-wrapper");
let w = window.innerWidth;
let h = window.innerHeight;
let audioElm, imgElm;
let frogIdx;
let frogSize = 0;

readyButton.addEventListener("click", function () {
  mainWrapper.append(imgElm); // the imgElm is created below but only made visible here
  readyButton.remove();

  // socket communication

  // inform server of my role (frog and which frog)
  let data = {
    role: "frog",
    frogIdx: frogIdx,
  };
  socket.emit("my-role", data);

  // listen to server socket messages and play sound in accordance
  socket.on("make-sound", function () {
    audioElm.play();
  });

  // TESTING IF JS CAN PLAY THE AUDIO:
  setTimeout(function () {
    audioElm.play();
  }, 100);
});

window.addEventListener("load", function () {
  console.log("ready");

  // pick a random frog index:
  frogIdx = Math.floor(Math.random() * 9);

  // create the according audio element:
  audioElm = document.createElement("audio");
  audioElm.controls = true;
  audioElm.id = "frogSound";
  audioElm.innerHTML =
    `
        <source src="sounds/d` +
    frogIdx +
    `.wav" type="audio/mpeg">
        Your browser does not support the audio element.
    `;

  // pick the according image element
  imgElm = document.createElement("img");
  imgElm.src = "../imgs/frog" + frogIdx + ".png";
  imgElm.id = "frogImg";
  imgElm.style.filter = "grayscale(100%)";

  if (w > h) {
    frogSize = Math.min(h, 400);
  } else {
    frogSize = Math.min(w, 400);
  }
  imgElm.width = frogSize;
  imgElm.height = frogSize;

  // TESTING SOUND:
  // imgElm.addEventListener("click", function(){
  //     audioElm.play();
  // })
});
