const express = require('express')
const {
  getMetadata,
  getMetadataSubm,
  createMetadata,
  deleteMetadata,
  updateMetadata
} = require('../controllers/metadataController')

const router = express.Router()

// GET all metadata
router.get('/', getMetadata)

// GET a single submission of metadata
router.get('/:id', getMetadataSubm)

// POST a submission of metadata
router.post('/', createMetadata)

// DELETE a submission of metadata
router.delete('/:id', deleteMetadata)

// UPDATE a submission of metadata
router.patch('/:id', updateMetadata)

module.exports = router