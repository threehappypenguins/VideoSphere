const express = require('express')

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
router.post('/', (req, res) => {
  res.json({mssg: 'POST a submission of metadata'})
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