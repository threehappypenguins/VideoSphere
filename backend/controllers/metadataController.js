const Metadata = require('../models/metadataModel')
const mongoose = require('mongoose')

// Get all metadata
const getMetadata = async (req, res) => {
  const metadata = await Metadata.find({}).sort({createdAt: -1})

  res.status(200).json(metadata)
}

// Get a single submission of metadata
const getMetadataSubm = async (req, res) => {
  const { id } = req.params

  if (!mongoose.Types.ObjectId.isValid(id)) {
    return res.status(404).json({error: 'No such metadata submission.'})
  }

  const metadatasubm = await Metadata.findById(id)

  if (!metadatasubm) {
    return res.status(404).json({error: 'No such metadata submission.'})
  }

  res.status(200).json(metadatasubm)
}

// Create a new submission of metadata
const createMetadata = async (req, res) => {
  const {title, description, date, visibility} = req.body

  // Add doc to db
  try{
    const metadatasubm = await Metadata.create({title, description, date, visibility})
    res.status(200).json(metadatasubm)
  } catch (error) {
    res.status(400).json({error: error.message})
  }
}

// Delete a submission of metadata
const deleteMetadata = async (req, res) => {
  const { id } = req.params

  if (!mongoose.Types.ObjectId.isValid(id)) {
    return res.status(404).json({error: 'No such metadata submission.'})
  }

  const metadatasubm = await Metadata.findOneAndDelete({_id: id})

  if (!metadatasubm) {
    return res.status(404).json({error: 'No such metadata submission.'})
  }

  res.status(200).json(metadatasubm)
}

// Update a submission of metadata
const updateMetadata = async (req, res) => {
  const { id } = req.params

  if (!mongoose.Types.ObjectId.isValid(id)) {
    return res.status(404).json({error: 'No such metadata submission.'})
  }

  const metadatasubm = await Metadata.findOneAndUpdate({_id: id}, {
    ...req.body
  })

  if (!metadatasubm) {
    return res.status(404).json({error: 'No such metadata submission.'})
  }

  res.status(200).json(metadatasubm)
}

module.exports = {
  getMetadata,
  getMetadataSubm,
  createMetadata,
  deleteMetadata,
  updateMetadata
}