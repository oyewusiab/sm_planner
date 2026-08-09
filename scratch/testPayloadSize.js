import { getDB, serializeDBForRemote } from "../src/utils/storage.js";

// Test payload size
const rawDb = getDB();
const remoteDb = serializeDBForRemote(rawDb);
const jsonString = JSON.stringify({ action: "import", db: remoteDb, mode: "replace" });
console.log("Payload size in bytes:", jsonString.length);
console.log("Payload size in KB:", (jsonString.length / 1024).toFixed(2) + " KB");
