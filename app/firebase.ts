import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyC7ZMH8T9eyjTHFjcxxLVVlCOD5IDF5QgY",
  authDomain: "shared-reading-ef410.firebaseapp.com",
  projectId: "shared-reading-ef410",
  storageBucket: "shared-reading-ef410.firebasestorage.app",
  messagingSenderId: "285081393619",
  appId: "1:285081393619:web:8b7614e19299465f4af726",
};

const app = initializeApp(firebaseConfig);

export const db = getFirestore(app);