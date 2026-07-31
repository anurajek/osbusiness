import { SectionHeader } from '../components/ui'
import ReceivablesScreen from './ReceivablesScreen'
import PayablesScreen from './PayablesScreen'

export default function ARAPScreen({ tab, onTabChange }) {
  return (
    <>
      <SectionHeader title="AR / AP" note="who owes you, who you owe" />
      <div className="tabs">
        <button className={`tab ${tab === 'receivables' ? 'tab--active' : ''}`} onClick={() => onTabChange('receivables')}>Receivables</button>
        <button className={`tab ${tab === 'payables' ? 'tab--active' : ''}`} onClick={() => onTabChange('payables')}>Payables</button>
      </div>
      {tab === 'receivables' ? <ReceivablesScreen /> : <PayablesScreen />}
    </>
  )
}
