import { MetadataContext } from "../context/MetadataContext";
import { useContext } from "react";

export const useMetadataContext = () => {
  const context = useContext(MetadataContext);

  if (!context) {
    throw Error(
      "useMetadataContext must be used inside a MetadataContextProvider"
    );
  }

  return context;
};
