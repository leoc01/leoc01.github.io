var myHeading = document.querySelector('h1');
myHeading.textContent = 'Hello World!';

var myButton = document.querySelector('button');

var myImage = document.querySelector('img');

var storedNameAux = localStorage.getItem('name');

myImage.onclick = function () {
    var mySrc = myImage.getAttribute('src');
    if (mySrc === 'images/old-computer.png') {
        myImage.setAttribute('src', 'images/cassete.png');
    } else {
        myImage.setAttribute('src', 'images/old-computer.png');
    }
}

function setUserName() {
    var myName = prompt('Please, enter your nick.');
    localStorage.setItem('name', myName);
    myHeading.textContent = "You're welcome, " + myName + ".";
}

if (!localStorage.getItem('name')) {
    setUserName();
} else {
    var storedName = localStorage.getItem('name');
    myHeading.textContent = "You're welcome, " + storedName + ".";
}

myButton.onclick = function () {
    setUserName();
    if (myHeading.textContent === "You're welcome, null.") {
        myHeading.textContent = "You're welcome, " + storedNameAux + ".";
    }
}