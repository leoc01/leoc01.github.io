var myHeading = document.querySelector('h1');
myHeading.textContent = 'Hello World!';

var myButton = document.querySelector('button');

var myImage = document.querySelector('img');

myImage.onclick = function () {
    var mySrc = myImage.getAttribute('src');
    if (mySrc === 'images/old-computer.png') {
        myImage.setAttribute('src', 'images/cassete.png');
    } else {
        myImage.setAttribute('src', 'images/old-computer.png');
    }
}

function setUserName() {
    var myName = prompt('Por favor, digite seu nome.');
    localStorage.setItem('name', myName);
    myHeading.textContent = 'Seja bem-vindo ' + myName;
}

if (!localStorage.getItem('name')) {
    setUserName();
} else {
    var storedName = localStorage.getItem('name');
    myHeading.textContent = 'Seja bem-vindo ' + storedName;
}

myButton.onclick = function () {
    setUserName();
}