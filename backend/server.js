require('dotenv').config()

const express = require('express')
const mongoose = require('mongoose')
const metadataRoutes = require('./routes/metadata')

// Express app
const app = express()

// Middleware
app.use(express.json())

app.use((req, res, next) => {
  console.log(req.path, req.method)
  next()
})

//  Routes
app.use('/api/metadata', metadataRoutes)

// Connect to db
mongoose.connect(process.env.MONGO_URI)
  .then(() => {
    // Listen for requests
    app.listen(process.env.PORT, () => {
      console.log('Connected to the db & listening on port', process.env.PORT)
    })
  })
  .catch((error) => {
    console.log(error)
  })