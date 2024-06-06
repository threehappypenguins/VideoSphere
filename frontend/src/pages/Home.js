import { useEffect, useState } from 'react'

// Components
import MetadataDetails from '../components/MetadataDetails'
import MetadataForm from '../components/MetadataForm'

const Home = () => {
  const [metadata, setMetadata] = useState(null)

  useEffect(() => {
    const fetchMetadata = async () => {
      const response = await fetch('/api/metadata')
      const json = await response.json()

      if (response.ok) {
        setMetadata(json)
      }
    }

    fetchMetadata()
  }, [])

  return (
    <div className="home">
      <div className="metadata">
        {metadata && metadata.map((metadatasubm) => (
          <MetadataDetails key={metadatasubm._id} metadatasubm={metadatasubm} />
        ))}
      </div>
      <MetadataForm />
    </div>
  )
}

export default Home