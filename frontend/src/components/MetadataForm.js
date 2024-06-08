import { useState, useEffect } from "react"
import Select from 'react-select'
import moment from 'moment-timezone'

const MetadataForm = ({ onSubmit }) => {
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [date, setDate] = useState('')
  const [time, setTime] = useState('')
  const [timezone, setTimezone] = useState('')
  const [visibility, setVisibility] = useState('Public')
  const [error, setError] = useState(null)
  const [emptyFields, setEmptyFields] = useState([])

  const visibilityOptions = ['Private', 'Unlisted', 'Public']

  const timezoneOptions = moment.tz.names().map((tz) => {
    const offset = moment.tz(tz).format('Z')
    return {
      value: tz,
      label: `${tz} (UTC${offset})`
    }
  })

  useEffect(() => {
    // Detect user's timezone
    const userTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone
    setTimezone(userTimezone)
  }, [])

  const handleSubmit = async (e) => {
    e.preventDefault()

    // Combine date and time
    const combinedDateTimeString = `${date}T${time}`
    const zonedDateTime = moment.tz(combinedDateTimeString, timezone)
    const formattedDate = zonedDateTime.toDate()

    const metadatasubm = {
      title,
      description,
      date: formattedDate,
      visibility
    }

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
      setEmptyFields(json.emptyFields)
    }
    if (response.ok) {
      setTitle('')
      setDescription('')
      setDate('')
      setTime('')
      setTimezone(Intl.DateTimeFormat().resolvedOptions().timeZone)
      setVisibility('')
      setError(null)
      setEmptyFields([])
      console.log('New metadata submission added.', json)
      onSubmit(json)
    }
  }

  return (
    <form className="create" onSubmit={handleSubmit}>
      <h3>Add New Metadata</h3>

      <label htmlFor="title">Title:</label>
      <input 
        id="title"
        name="title"
        type="text"
        onChange={(e) => setTitle(e.target.value)}
        value={title}
        className={emptyFields.includes('title') ? 'error' : ''}
        />

      <label htmlFor="description">Description:</label>
      <textarea
        id="description"
        name="description"
        onChange={(e) => setDescription(e.target.value)}
        value={description}
      />

      <label htmlFor="date">Select Scheduled Date:</label>
      <input
        id="date"
        name="date"
        type="date"
        onChange={(e => setDate(e.target.value))}
        value={date}
        className={emptyFields.includes('date') ? 'error' : ''}
      />

      <label htmlFor="time">Select Scheduled Time:</label>
      <input
        id="time"
        name="time"
        type="time"
        onChange={(e) => setTime(e.target.value)}
        value={time}
        className={emptyFields.includes('time') ? 'error' : ''}
      />

      <label htmlFor="timezone">Select Timezone:</label>
      <Select
        inputId="timezone"
        name="timezone"
        options={timezoneOptions}
        onChange={(selectedOption) => setTimezone(selectedOption.value)}
        value={timezoneOptions.find(option => option.value === timezone)}
        className={emptyFields.includes('timezone') ? 'error' : ''}
      />

      <label>Visibility:
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
              className={emptyFields.includes('visibility') ? 'error' : ''}
            />
            <label htmlFor={`visibility-${option}`}>{option}</label>
          </div>
        ))}
      </div>
      </label>

      <button>Add Metadata</button>
      {error && <div className="error">{error}</div>}
      </form>
  )
}

export default MetadataForm