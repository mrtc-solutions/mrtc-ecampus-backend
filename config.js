// Firebase Configuration
const firebaseConfig = {
    apiKey: "AIzaSyBFEAw4iQnCMdLaG4nv0HibP9gDIMNhE5g",
    authDomain: "mrtc-ecampus.web.app",
    projectId: "mrtc-ecampus",
    storageBucket: "mrtc-ecampus.firebasestorage.app",
    messagingSenderId: "215636946341",
    appId: "1:215636946341:web:ea7f15477b7f123aba4c4c",
    measurementId: "G-W1HQMDCZNJ"
};

// Initialize Firebase
firebase.initializeApp(firebaseConfig);

// Initialize Services
const auth = firebase.auth();
const db = firebase.firestore();
const storage = firebase.storage();
const functions = firebase.functions();

// Export for use
window.firebaseAuth = auth;
window.firebaseDb = db;
window.firebaseStorage = storage;