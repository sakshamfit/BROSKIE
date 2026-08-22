import React, { Suspense } from 'react';

/**
 * Web twin of AIGreeterModelLoader.
 *
 * The AI greeter pulls in three.js + the GLTF loader, which are the single
 * largest optional dependency in the app. The model is only rendered when
 * the once-per-day greeting sheet is actually open, so on web we keep it in
 * its own async chunk and load it only then. The rest of the app no longer
 * pays for the 3D engine before it is needed.
 */
const LazyAIGreeterModel = React.lazy(() => import('./AIGreeterModel'));

export default function AIGreeterModelLoader(props) {
  return (
    <Suspense fallback={null}>
      <LazyAIGreeterModel {...props} />
    </Suspense>
  );
}
