import { useMetadataContext } from '../hooks/useMetadataContext'

// Date fns
import { format } from 'date-fns'
import formatDistanceToNow from 'date-fns/formatDistanceToNow'

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
      <h4>{metadatasubm.title}</h4>
      <p><strong>Description: </strong>{metadatasubm.description}</p>
      <p><strong>Date: </strong>{format(new Date(metadatasubm.date), 'MMMM d, yyyy')}</p>
      <p><strong>Visibility: </strong>{metadatasubm.visibility}</p>
      <p>{formatDistanceToNow(new Date(metadatasubm.createdAt), { addSuffix: true })}</p>
      <span className="material-symbols-outlined" onClick={handleClick}>delete</span>
    </div>
  )
}

export default MetadataDetails