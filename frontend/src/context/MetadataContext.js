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