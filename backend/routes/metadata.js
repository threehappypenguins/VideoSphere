const express = require('express')
const Metadata = require('../models/metadataModel')

const router = express.Router()

// GET all metadata
router.get('/', (req, res) => {
  res.json({mssg: 'GET all metadata.'})
})

// GET a single submission of metadata
router.get('/:id', (req, res) => {
  res.json({mssg: 'GET a single submission of metadata.'})
})

// POST a submission of metadata
router.post('/', async (req, res) => {
  const {title, description, date, visibility} = req.body

  try{
    const metadata = await Metadata.create({title, description, date, visibility})
    res.status(200).json(metadata)
  } catch (error) {
    res.status(400).json({error: error.message})
  }
})

// DELETE a submission of metadata
router.delete('/:id', (req, res) => {
  res.json({mssg: 'DELETE a submission of metadata'})
})

// UPDATE a submission of metadata
router.patch('/:id', (req, res) => {
  res.json({mssg: 'UPDATE a submission of metadata'})
})

module.exports = router