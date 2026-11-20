import { SimulatorSurface } from '@/components/stackchan/simulator-surface'
import { useSimulatorEngine } from '@/features/simulator/use-simulator-engine'

export function SimulatorPage() {
  const simulator = useSimulatorEngine()
  return <SimulatorSurface controller={simulator} />
}
