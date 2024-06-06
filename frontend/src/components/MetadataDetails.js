const MetadataDetails = ({ metadatasubm }) => {
  return (
    <div className="metadata-details">
      <h4>Title: {metadatasubm.title}</h4>
      <p><strong>Description: </strong>{metadatasubm.description}</p>
      <p><strong>Date: </strong>{metadatasubm.date}</p>
      <p><strong>Description: </strong>{metadatasubm.description}</p>
      <p>Visibility: {metadatasubm.visibility}</p>
      <p>{metadatasubm.createdAt}</p>
    </div>
  )
}

export default MetadataDetails