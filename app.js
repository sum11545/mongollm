const express = require("express");
const app = express();
require("dotenv").config();
// const mongoose = require("mongoose");
const { MongoClient, FindCursor } = require("mongodb");
const cors = require("cors");
const path = require("path");
const cron = require("node-cron"); // Import cron

const port = process.env.PORT || 3000;

app.use(
  cors({
    origin: "*",
    methods: "GET,POST",
  })
);
app.use(express.json());
app.use(express.static("./public"));
// app.set("views", "./views");
// app.set("view engine", "ejs"); // Use app.set, not app.use

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "./public", "index.html"));
});

cron.schedule("*/5 * * * *", () => {
  console.log("🔄 Restarting server...");
  process.exit(1); // Exits the process, a process manager should restart it
});

//Mongoose

// mongoose
//   .connect("mongodb://localhost:27017/Mongo_LLM")
//   .then(() => console.log(" Database Connected"))
//   .catch((err) => console.error(" Connection Error:", err));

const uri = process.env.MONGO_URI;
const client = new MongoClient(uri, { monitorCommands: false });
let db;

async function connectDB() {
  await client.connect();
  db = client.db("Mongo_LLM");
  console.log("Connected to MongoDB");
}
connectDB();

app.post("/mongoPrompt", async (req, res) => {
  const prompt = req.body.prompt;
  const apiKey = process.env.APIKEY;

  if (prompt.startsWith("db.")) {
    console.log("Direct MongoDB Query Detected:", prompt);
    try {
      let collectionName = null;
      let isCreateCollection = false;

      // Handle db.createCollection("students") separately
      const createMatch = prompt.match(
        /db\.createCollection\(["'`](.*?)["'`]\)/
      );

      console.log(typeof createMatch);

      if (createMatch) {
        collectionName = createMatch[1]; // Extracted "students"
        isCreateCollection = true;
      } else {
        // Handle normal db.collectionName.find() type queries
        const match = prompt.match(/db\.([^.]+)\./);
        if (!match || !match[1]) {
          return res.status(400).json({
            success: false,
            message: "Invalid MongoDB query format",
          });
        }
        collectionName = match[1]; // Extract collection name
      }
      console.log("Detected Collection:", collectionName);
      if (isCreateCollection) {
        try {
          // Check if the collection already exists
          const existingCollections = await db.listCollections().toArray();
          const collectionExists = existingCollections.some(
            (col) => col.name === collectionName
          );

          if (collectionExists) {
            return res.json({
              success: false,
              message: `Collection '${collectionName}' already exists.`,
            });
          }
          await db.createCollection(collectionName);

          console.log("Collection Create Successfully"); // Log the result before sending
          return res.json({
            success: true,
            message: `Collection '${collectionName}' created successfully!`,
          });
        } catch (error) {
          console.error("❌ Error Creating Collection:", error);
          return res.status(500).json({
            success: false,
            message: "Failed to create collection",
            error: error.message,
          });
        }
      } else {
        let collection = db.collection(collectionName);

        // Replace db.collection with the correct reference
        let mongoQuery = prompt.replace(/db\.[^.]+\./, "collection.");
        console.log("mongoQueryis:", mongoQuery);

        // Execute the query
        let result = await eval(`(async ()=> { return ${mongoQuery}; })()`);

        // Convert FindCursor to an array if necessary
        if (result instanceof FindCursor) {
          result = await result.toArray();
        }

        console.log("Direct Query Result:", result);
        return res.json({ success: true, query: prompt, data: result || {} });
      }
    } catch (error) {
      console.error("Direct Execution Error:", error);
      return res.status(400).json({
        success: false,
        message: "Error executing query",
        error: error.message,
      });
    }
  } else {
    try {
      const resposne = await fetch(
        "https://api.groq.com/openai/v1/chat/completions",

        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model: "llama-3.3-70b-versatile",
            messages: [
              {
                role: "user",
                content: `Generate only mongo query no running method etc ${prompt} in javascript  `,
              },
            ],
          }),
        }
      );

      const data = await resposne.json();
      console.log(data);
      console.log(data.choices[0].message.content);
      res.json({
        result: data.choices[0].message.content,
      });

      let mongoData = " ";
      if (
        data.choices &&
        data.choices.length > 0 &&
        data.choices[0].message &&
        data.choices[0].message.content
      ) {
        const content = data.choices[0].message.content;
        const regex = /```javascript\s*\n([\s\S]+?)\n```/;
        const match = content.match(regex);

        console.log("data is", match);
        if (match && match[1]) {
          mongoData = match[1];
          console.log("Extracted Query:", mongoData); // Clean query
        } else {
          console.log("No query found.");
        }
      }
    } catch (error) {
      res.status(400).json({
        message: "Error",
        error: error,
      });
    }
  }
});

app.post("/execMongo", async (req, res) => {
  let mongo = req.body.query;
  console.log("Query is:", mongo);
  console.log(typeof mongo);
  if (!mongo || typeof mongo !== "string" || mongo.trim() === "") {
    return res
      .status(400)
      .json({ success: false, message: "Invalid query format" });
  }
  let isGetCollections = false;
  let isCreateCollection = false;
  let collectionName = null;

  if (mongo.trim() === "db.getCollectionNames()") {
    isGetCollections = true;
  } else if (/^db\.createCollection\(["']([^"']+)["']\)$/i.test(mongo.trim())) {
    isCreateCollection = true;
    collectionName = mongo.match(
      /^db\.createCollection\(["']([^"']+)["']\)$/i
    )[1];
    console.log("Collection Name:", collectionName);
  } else {
    const match = mongo.match(/db\.([^.]+)\./i);
    if (match && match[1]) {
      collectionName = match[1];
      console.log("Extracted Collection Name:", collectionName);
    } else {
      return res.json({
        success: false,
        message: "Invalid query: No collection found",
      });
    }
  }

  try {
    if (isGetCollections) {
      let results;
      results = await db.listCollections().toArray();
      results = results.map((coll) => coll.name); // Extract only collection names
      console.log(results);

      res.json({ success: true, collections: results });
    } else if (isCreateCollection) {
      console.log(`Creating Collection: ${collectionName}...`);
      if (!db) {
        console.error("Database connection not initialized!");
        return res
          .status(500)
          .json({ success: false, message: "Database not connected!" });
      }
      const existingCollections = await db
        .listCollections({ name: collectionName })
        .toArray();
      if (existingCollections.length > 0) {
        return res.json({
          success: false,
          message: `Collection '${collectionName}' already exists!`,
        });
      }
      await db.createCollection(collectionName);
      console.log("New Collection Created:");
      return res.json({
        success: true,
        message: `Collection '${collectionName}' created successfully!`,
      });
    } else {
      let collection = db.collection(collectionName);

      const collections = await db
        .listCollections({ name: collectionName })
        .toArray();
      if (collections.length === 0) {
        console.log(
          ` Collection '${collectionName}' does not exist. Creating it...`
        );
        await db.createCollection(collectionName);
      }

      collection = db.collection(collectionName);

      mongo = mongo.replace(/db\.([^.]+)\./, "collection.");

      let result = await eval(`(async ()=> {return ${mongo};})()`);
      // console.log(result);
      if (result instanceof FindCursor) {
        result = await result.toArray();
      }
      console.log(result.constructor.name);

      console.log("Result to send:", JSON.stringify(result)); // Log the result before sending
      res.json({ success: true, data: result ? result : {} });
    }
  } catch (error) {
    console.error("Execution Error:", error);
    res.status(400).json({ success: false, message: "Error executing query" });
  }
});

app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
