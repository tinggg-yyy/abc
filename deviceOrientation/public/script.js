// window.addEventListener("deviceorientation", handleOrientation, true); // can be deleted later

function handleOrientation(eventData) {
  console.log(eventData.alpha);

  // function handleOrientation(aaa) {
  //   console.log(aaa);

      document.querySelector('#alpha').innerText = "alpha: " + Math.round(eventData.alpha);
      document.querySelector('#beta').innerText = "beta: " + Math.round(eventData.beta);
      document.querySelector('#gamma').innerText = "gamma: " + Math.round(eventData.gamma);

      document.querySelector('h1').style.display = "none";
      document.querySelector('#requestOrientationButton').style.display = "none";

document.querySelector('#square').style.transform = "rotate("+eventData.alpha+"deg)";
}
