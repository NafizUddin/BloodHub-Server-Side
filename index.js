require("dotenv").config();
const express = require("express");
const cors = require("cors");
const jwt = require("jsonwebtoken");
const cookieParser = require("cookie-parser");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const port = process.env.PORT || 3000;
const app = express();
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);

app.use(express.json());
app.use(cookieParser());
app.use(
  cors({
    origin: ["https://bloodhub-fullstack-a12.netlify.app"], // Client Side Server
    credentials: true,
  })
);

// middlewares
// verify token for cookies
const verifyToken = async (req, res, next) => {
  try {
    const token = req.cookies?.token;
    if (token) {
      jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, (error, decoded) => {
        if (error) {
          return res
            .status(401)
            .send({ status: 401, message: "Unauthorized Access" });
        } else {
          req.user = decoded;
          next();
        }
      });
    } else {
      return res
        .status(401)
        .send({ status: 401, message: "Unauthorized Access" });
    }
  } catch (error) {
    res.status(401).send("Unauthorized");
  }
};

// verify token for localStorage
// const verifyToken = (req, res, next) => {
//   console.log("inside verify token", req.headers.authorization);
//   if (!req.headers.authorization) {
//     return res.status(401).send({ message: "unauthorized access" });
//   }
//   const token = req.headers.authorization.split(" ")[1];
//   jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, (err, decoded) => {
//     if (err) {
//       return res.status(401).send({ message: "unauthorized access" });
//     }
//     req.decoded = decoded;
//     next();
//   });
// };

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASSWORD}@cluster0.wixlrgj.mongodb.net/?retryWrites=true&w=majority`;

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    // await client.connect();

    const fundingCollection = client.db("bloodHub").collection("funding");
    const usersCollection = client.db("bloodHub").collection("users");
    const donationCollection = client.db("bloodHub").collection("donations");
    const blogCollection = client.db("bloodHub").collection("blogs");

    // JWT Related API

    // set Token in Cookies
    app.post("/api/auth/access-token", async (req, res) => {
      const user = req.body;
      const token = jwt.sign(user, process.env.ACCESS_TOKEN_SECRET, {
        expiresIn: "1h",
      });
      res
        .cookie("token", token, {
          httpOnly: true,
          secure: process.env.NODE_ENV === "production",
          sameSite: process.env.NODE_ENV === "production" ? "none" : "strict",
        })
        .send({ success: true });
    });

    // Set token in local storage
    // app.post("/api/auth/access-token", async (req, res) => {
    //   const user = req.body;
    //   const token = jwt.sign(user, process.env.ACCESS_TOKEN_SECRET, {
    //     expiresIn: "1h",
    //   });
    //   res.send({ token });
    // });

    app.post("/api/auth/logout", async (req, res) => {
      const user = req.body;

      res
        .clearCookie("token", { maxAge: 0, sameSite: "none", secure: true })
        .send({ success: true });
    });

    // User Related API
    app.get("/api/users", async (req, res) => {
      const queryEmail = req.query?.email;
      const queryDistrict = req.query.district;
      const queryUpazilla = req.query.upazilla;
      let queryBlood;
      if (req.query.blood) {
        if (req?.query?.blood.split(" ")[1] === "positive") {
          queryBlood = req.query.blood.split(" ")[0] + "+";
        } else {
          queryBlood = req.query.blood.split(" ")[0] + "-";
        }
      }

      let query = {};
      if (queryBlood && queryDistrict && queryUpazilla) {
        query.bloodGroup = queryBlood;
        query.district = queryDistrict;
        query.upazilla = queryUpazilla;
        query.role = "donor";
      }
      const result = await usersCollection.find(query).toArray();
      res.send(result);
    });

    app.get("/api/users/:email", async (req, res) => {
      const email = req.params.email;
      const query = { email: email };
      const result = await usersCollection.findOne(query);
      res.send(result);
    });

    app.get("/api/user/pagination", async (req, res) => {
      const page = parseInt(req.query.page);
      const size = parseInt(req.query.size);
      const status = req.query.status;

      const query = { status: status };

      const result = await usersCollection
        .find(query)
        .skip(page * size)
        .limit(size)
        .toArray();
      res.send(result);
    });

    app.get("/api/existingUsers/:email", async (req, res) => {
      const email = req.params.email;
      const query = { email: email };
      const existingUser = await usersCollection.findOne(query);
      if (existingUser) {
        res.send({ found: true });
      } else {
        res.send({ found: false });
      }
    });

    app.post("/api/users", async (req, res) => {
      const user = req.body;

      const query = { email: user.email };
      const existingUser = await usersCollection.findOne(query);
      if (existingUser) {
        return res.send({ message: "user already exists", insertedId: null });
      }
      const result = await usersCollection.insertOne(user);
      res.send(result);
    });

    app.get("/api/userCount", async (req, res) => {
      const result = await usersCollection
        .find({ $or: [{ role: "donor" }, { role: "volunteer" }] })
        .toArray();
      const countLength = result.length;

      res.send({ count: countLength });
    });

    app.get("/api/allUsersCount", async (req, res) => {
      let query = {};
      if (req.query.status) {
        query.status = req.query.status;
      }
      const result = await usersCollection.find(query).toArray();
      const countLength = result.length;
      res.send({ count: countLength });
    });

    app.patch("/api/users/singleUser/:id", async (req, res) => {
      const id = req.params.id;

      const filter = { _id: new ObjectId(id) };
      const setStatus = {
        $set: req.body,
      };
      const result = await usersCollection.updateOne(filter, setStatus);
      res.send(result);
    });

    // Blood Donation related API

    app.get("/api/donation", async (req, res) => {
      const queryEmail = req.query?.email;
      const page = parseInt(req.query.page);
      const size = parseInt(req.query.size);
      const donationStatus = req.query.status;

      if (queryEmail && (page || size)) {
        query = {
          donorEmail: queryEmail,
        };

        const result = await donationCollection
          .find(query)
          .skip(page * size)
          .limit(size)
          .toArray();
        res.send(result);
      } else if (donationStatus) {
        const query = {
          status: donationStatus,
        };
        const result = await donationCollection.find(query).toArray();
        res.send(result);
      } else {
        let query = {};
        if (queryEmail) {
          query = {
            donorEmail: queryEmail,
          };
        }
        const result = await donationCollection.find(query).toArray();
        res.send(result);
      }
    });

    app.get("/api/allDonation/pagination", async (req, res) => {
      const page = parseInt(req.query.page);
      const size = parseInt(req.query.size);

      const result = await donationCollection
        .find()
        .skip(page * size)
        .limit(size)
        .toArray();
      res.send(result);
    });

    app.get("/api/donation/:id([0-9a-fA-F]{24})", async (req, res) => {
      const id = req.params.id;
      const donationStatus = req.query.status;

      const query = {
        $and: [
          { _id: new ObjectId(id) },
          {
            status: donationStatus,
          },
        ],
      };
      const result = await donationCollection.findOne(query);
      res.send(result);
    });

    app.patch("/api/donation/singleDonation/:id", async (req, res) => {
      const id = req.params.id;

      const filter = { _id: new ObjectId(id) };
      const setStatus = {
        $set: req.body,
      };
      const result = await donationCollection.updateOne(filter, setStatus);
      res.send(result);
    });

    app.post("/api/donation", async (req, res) => {
      const donation = req.body;
      const result = await donationCollection.insertOne(donation);
      res.send(result);
    });

    app.get("/api/donationCount", async (req, res) => {
      const queryEmail = req.query.email;
      let query = {};
      if (queryEmail) {
        query = {
          donorEmail: queryEmail,
        };
      }
      const result = await donationCollection.find(query).toArray();
      const countLength = result.length;

      res.send({ count: countLength });
    });

    app.get("/api/allDonationCount", async (req, res) => {
      const result = await donationCollection.find().toArray();
      const countLength = result.length;
      res.send({ count: countLength });
    });

    app.delete("/api/donation/:id([0-9a-fA-F]{24})", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await donationCollection.deleteOne(query);
      res.send(result);
    });

    // Blog Related API

    app.get("/api/blogs", async (req, res) => {
      const result = await blogCollection.find().toArray();
      res.send(result);
    });

    app.get("/api/publishedBlogs", async (req, res) => {
      const blogStatus = req.query.status;
      const query = {
        blogStatus: blogStatus,
      };
      const result = await blogCollection.find(query).toArray();
      res.send(result);
    });

    app.post("/api/blogs", async (req, res) => {
      const blog = req.body;
      const result = await blogCollection.insertOne(blog);
      res.send(result);
    });

    app.patch(
      "/api/blogs/singleBlog/:id([0-9a-fA-F]{24})",
      async (req, res) => {
        const id = req.params.id;

        const filter = { _id: new ObjectId(id) };
        const setStatus = {
          $set: req.body,
        };
        const result = await blogCollection.updateOne(filter, setStatus);
        res.send(result);
      }
    );

    app.delete("/api/blogs/:id([0-9a-fA-F]{24})", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await blogCollection.deleteOne(query);
      res.send(result);
    });

    // Card Related API

    app.post("/api/create-payment-intent", async (req, res) => {
      const { amount } = req.body;
      const amountNum = parseInt(amount * 100);

      console.log(amountNum);
      // Create a PaymentIntent with the order amount and currency
      const paymentIntent = await stripe.paymentIntents.create({
        amount: amountNum,
        currency: "usd",
        payment_method_types: ["card"],
      });

      res.send({
        clientSecret: paymentIntent.client_secret,
      });
    });

    // Funding related API

    app.get("/api/funding", async (req, res) => {
      const result = await fundingCollection
        .aggregate([
          {
            $group: {
              _id: null,
              total: { $sum: "$donation" },
            },
          },
        ])
        .toArray();
      res.send(result);
    });

    app.get("/api/funding/:email", async (req, res) => {
      const email = req.params.email;
      const query = {
        email: email,
      };
      const result = await fundingCollection.find(query).toArray();
      res.send(result);
    });

    app.post("/api/funding", async (req, res) => {
      const payment = req.body;
      const result = await fundingCollection.insertOne(payment);
      res.send(result);
    });

    // await client.db("admin").command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!"
    );
  } finally {
    // await client.close();
  }
}
run().catch(console.dir);

// users Related API

app.get("/", (req, res) => {
  res.send("Server is running perfectly");
});

app.listen(port, () => {
  console.log(`Example app listening on port ${port}`);
});
