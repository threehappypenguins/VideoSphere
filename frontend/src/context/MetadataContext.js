import { createContext, useReducer } from 'react'

export const MetadataContext = createContext()

export const metadataReducer = (state, action) => {
  switch (action.type) {
    case 'SET_METADATA':
      return {
        metadata: action.payload
      }
    case 'CREATE_METADATA':
      return {
        metadata: [action.payload, ...state.metadata]
      }
    case 'DELETE_METADATA':
      return {
        metadata: state.metadata.filter((m) => m._id !== action.payload._id)
      }
    default: 
      return state
  }
}

export const MetadataContextProvider = ({ children }) => {
  const [state, dispatch] = useReducer(metadataReducer, {
    metadata: null
  })

  return (
    <MetadataContext.Provider value={{...state, dispatch}}>
      { children }
    </MetadataContext.Provider>
  )
}