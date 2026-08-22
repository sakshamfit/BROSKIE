import React from 'react';
import AIGreeterModel from './AIGreeterModel';

/**
 * Native twin of AIGreeterModelLoader. On mobile the full 3D character is
 * part of the normal app bundle (React Native/Metro does not split native
 * chunks the same way as web), so this is a plain passthrough.
 */
export default function AIGreeterModelLoader(props) {
  return <AIGreeterModel {...props} />;
}
