import { useState } from "react"
import { useMetadataContext } from '../hooks/useMetadataContext'

const MetadataForm = () => {
  const { dispatch } = useMetadataContext()
  
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [date, setDate] = useState('')
  const [visibility, setVisibility] = useState('Public')
  const [error, setError] = useState(null)

  const visibilityOptions = ['Private', 'Unlisted', 'Public'];

  const handleSubmit = async (e) => {
    e.preventDefault()

    const metadatasubm = {title, description, date, visibility}

    const response = await fetch('/api/metadata', {
      method: 'POST',
      body: JSON.stringify(metadatasubm),
      headers: {
        'Content-Type': 'application/json'
      }
    })
    const json = await response.json()

    if (!response.ok) {

      setError(json.error)
    }
    if (response.ok) {
      setTitle('')
      setDescription('')
      setDate('')
      setVisibility('')
      setError(null)
      console.log('New metadata submission added.', json)
      dispatch({type: 'CREATE_METADATA', payload: json})
    }
  }

  return (
    <form className="create" onSubmit={handleSubmit}>
      <h3>Add New Metadata</h3>

      <label>Title:</label>
      <input 
        type="text"
        onChange={(e) => setTitle(e.target.value)}
        value={title}
        />

      <label>Description:</label>
      <textarea
        onChange={(e) => setDescription(e.target.value)}
        value={description}
      />

      <label>Select Scheduled Date:</label>
      <input
        type="date"
        onChange={(e => setDate(e.target.value))}
        value={date}
      />

      <label>Visibility:</label>
      <div>
        {visibilityOptions.map((option, index) => (
          <div key={index} className="radio-container">
            <input 
              type="radio" 
              id={`visibility-${option}`} 
              name="visibility" 
              value={option} 
              checked={visibility === option}
              onChange={(e) => setVisibility(e.target.value)} 
            />
            <label htmlFor={`visibility-${option}`}>{option}</label>
          </div>
        ))}
      </div>

      <button>Add Metadata</button>
      {error && <div className="error">{error}</div>}
      </form>
  )
}

export default MetadataForm