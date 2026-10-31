import { HostRouteBootstrapBoundary } from "@/components/host-route-bootstrap-boundary";
import { YuyiScreen } from "@/screens/yuyi-screen";

export default function HostYuyiRoute() {
  return (
    <HostRouteBootstrapBoundary>
      <YuyiScreen />
    </HostRouteBootstrapBoundary>
  );
}
