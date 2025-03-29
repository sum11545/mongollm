const express = require("express");
const app = express();
require("dotenv").config();
// const mongoose = require("mongoose");
const { MongoClient, FindCursor } = require("mongodb");
const cors = require("cors");
const path = require("path");
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static("./public"));

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
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
              content: `Generate only mongo query no running method etc ${prompt} in javascript `,
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
});

app.post("/execMongo", async (req, res) => {
  let mongo = req.body.query;
  console.log("Query is:", mongo);
  console.log(typeof mongo);

  if (!mongo) {
    return res
      .status(400)
      .json({ success: false, message: "Query is required" });
  }

  // Validate the query format
  if (typeof mongo !== "string" || mongo.trim() === "") {
    return res
      .status(400)
      .json({ success: false, message: "Invalid query format" });
  }

  try {
    let collection = db.collection("LLM");

    mongo = mongo.replace(/db\.collection/g, `db.collection("LLM")`);
    let result = await eval(`(async ()=> {return ${mongo};})()`);
    // console.log(result);
    if (result instanceof FindCursor) {
      result = await result.toArray();
    }
    console.log(result.constructor.name);

    console.log("Result to send:", JSON.stringify(result)); // Log the result before sending
    res.json({ success: true, data: result ? result : {} });
  } catch (error) {
    console.error("Execution Error:", error);
    res.status(400).json({ success: false, message: "Error executing query" });
  }
});

app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
