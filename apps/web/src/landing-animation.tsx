import { DotLottieReact, setWasmUrl } from '@lottiefiles/dotlottie-react';
import lottieWasmUrl from '@lottiefiles/dotlottie-web/dotlottie-player.wasm?url';
setWasmUrl(lottieWasmUrl);
export default function LandingAnimation() {
  return (
    <DotLottieReact
      src="/animations/Cleantooth.json"
      loop
      autoplay
      className="w-full max-w-lg lg:max-w-xl aspect-square"
      speed={0.8}
    />
  );
}
