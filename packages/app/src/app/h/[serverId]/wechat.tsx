import { useHostRouteServerId } from "@/navigation/host-route-context";
import { WeChatMain } from "@/components/wechat/wechat-layout";

export default function WeChatRoute() {
  const serverId = useHostRouteServerId();
  if (!serverId) return null;
  return <WeChatMain />;
}
