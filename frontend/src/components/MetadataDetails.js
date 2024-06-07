import { useMetadataContext } from '../hooks/useMetadataContext'

const MetadataDetails = ({ metadatasubm }) => {
  const { dispatch } = useMetadataContext()

  const handleClick = async () => {
    const response = await fetch('/api/metadata/' + metadatasubm._id, {
      method: 'DELETE'
    })
    const json = await response.json()
    
    if (response.ok) {
      dispatch({type: 'DELETE_METADATA', payload: json})
    }
  }

  return (
    <div className="metadata-details">
      <h4>Title: {metadatasubm.title}</h4>
      <p><strong>Description: </strong>{metadatasubm.description}</p>
      <p><strong>Date: </strong>{metadatasubm.date}</p>
      <p>Visibility: {metadatasubm.visibility}</p>
      <p>{metadatasubm.createdAt}</p>
      <span onClick={handleClick}>delete</span>
    </div>
  )
}

export default MetadataDetails