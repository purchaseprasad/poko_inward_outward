import { createContext, useContext } from 'react';

export const AuthCtx = createContext(null);
export const ListsCtx = createContext(null);
export const useAuth = () => useContext(AuthCtx);
export const useLists = () => useContext(ListsCtx);
