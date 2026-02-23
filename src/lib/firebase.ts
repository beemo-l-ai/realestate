import { Firestore } from "@google-cloud/firestore";
import { config } from "./config.js";

export const firestore = new Firestore({
  projectId: config.firebaseProjectId,
  credentials: {
    client_email: config.firebaseClientEmail,
    private_key: config.firebasePrivateKey,
  },
});
