const mongoose = require('mongoose')

const Schema = mongoose.Schema

const metadataSchema = new Schema({
  title: {
    type: String,
    required: true
  },
  description: {
    type: String,
    required: false
  },
  date: {
    type: Date,
    required: true
  },
  visibility: {
    type: String,
    enum: ['Private', 'Unlisted', 'Public'],
    required: true
  }
}, { timestamps: true })

module.exports = mongoose.model('Metadata', metadataSchema)