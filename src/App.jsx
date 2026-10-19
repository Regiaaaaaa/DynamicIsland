import DynamicIsland from "./components/DynamicIsland";
import { useMedia } from "./hooks/useMedia";

export default function App() {
  const { media, control } = useMedia();

  return (
    <DynamicIsland
      media={media}
      onPlayPause={() => control("playpause")}
      onNext={() => control("next")}
      onPrev={() => control("prev")}
    />
  );
}