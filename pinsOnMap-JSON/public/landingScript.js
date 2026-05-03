let formeElm = document.querySelector("#nameForm");
console.log(formeElm);
let nameInput = document.querySelector("#newName");
console.log(nameInput)
let nameInputButton = document.querySelector("#nameForm button");

let welcomeMessage = document.querySelector("#center-container p");
let goMapButton = document.querySelector("#goMapButton");

let userHUEKEY = "user-hueTEST"// why did i write test?

function assureUserHUE() {
    let hue = localStorage.getItem(userHUEKEY);
    if(hue == undefined){
        // userID = make a new one
        hue = Math.random()*360;
        // store on local storage:
        localStorage.setItem(userHUEKEY, hue);
    }
}

assureUserHUE();
setBackgroundColor();

function setBackgroundColor(){
    let hue = localStorage.getItem(userHUEKEY);
    console.log("hue", hue);
    document.body.style.backgroundColor = "hsl("+hue+", 50%, 60%)"

}

let usernameKEY = "user-nameTEST"// why did i write test?
function getExistingUsername() {
    let username = localStorage.getItem(usernameKEY); 
    return username
}

let username = getExistingUsername();

if(username == undefined){
    displayNameInput();
}else{
    displayWelcomeScreen();
}



function displayNameInput(){
    welcomeMessage.style.display = "none";
    formeElm.style.display = "flex";
}


function displayWelcomeScreen(){
    welcomeMessage.style.display = "block";
    goMapButton.style.display = "block";

    formeElm.style.display = "none";
    document.querySelector("#nameDisplay").innerText = username + "!";
}




// LISTEN FOR NEWLY TYPED MESSAGES, 
// SEND THEM TO THE SERVER
formeElm.addEventListener("submit", newNameSubmitted);
nameInput.addEventListener("input", newNameTyping);

function newNameTyping(){
    console.log(nameInput.value)
    if(nameInput.value != ""){
        console.log(nameInputButton)
        nameInputButton.style.visibility = "visible";
    }else{
        nameInputButton.style.visibility= "hidden";
    }
}
function newNameSubmitted(event){
    console.log(event);
    //stop form element from refreshing the page
    event.preventDefault();

    
    // clear out input:
    let name = nameInput.value;
    nameInput.value = "";
    console.log("nameInput", name);

    localStorage.setItem(usernameKEY, name);
    formeElm.style.display = "none";
    setTimeout(goToMap, 100)
}

goMapButton.addEventListener("click", goToMap)


function goToMap(){
    window.location.href = "map.html";
}