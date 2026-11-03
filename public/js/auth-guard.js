import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js";
import {
    getAuth,
    onAuthStateChanged,
    signOut
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";

const firebaseConfig = {
    apiKey: "AIzaSyAWAaOMrgUMIBoF3juw8hBbsFDvOQbe8Dg",
    authDomain: "sabor-2ef5c.firebaseapp.com",
    projectId: "sabor-2ef5c",
    storageBucket: "sabor-2ef5c.firebasestorage.app",
    messagingSenderId: "415510937397",
    appId: "1:415510937397:web:4af14bde21908d72ba167c",
    measurementId: "G-YXNDJQC9TX"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);

onAuthStateChanged(auth, (user) => {
    if (!user) {
        window.location.replace("login.html");
        return;
    }

    if (!user.emailVerified) {
        signOut(auth).finally(() => window.location.replace("login.html"));
        return;
    }

    document.documentElement.style.visibility = "visible";
});