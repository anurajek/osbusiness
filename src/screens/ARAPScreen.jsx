import { SectionHeader } from '../components/ui'
import ReceivablesScreen from './ReceivablesScreen'
import PayablesScreen from './PayablesScreen'
import PaymentFollowUpScreen from './PaymentFollowUpScreen'
import CollectionsTrendScreen from './CollectionsTrendScreen'

export default function ARAPScreen({ tab, onTabChange, navParams, clearNavParams, onNavigate }) {
  return (
    <>
      <SectionHeader title="AR / AP" note="who owes you, who you owe" />
      <div className="tabs">
        <button className={`tab ${tab === 'receivables' ? 'tab--active' : ''}`} onClick={() => onTabChange('receivables')}>Receivables</button>
        <button className={`tab ${tab === 'payables' ? 'tab--active' : ''}`} onClick={() => onTabChange('payables')}>Payables</button>
        <button className={`tab ${tab === 'invoice-followup' ? 'tab--active' : ''}`} onClick={() => onTabChange('invoice-followup')}>Invoice Follow-up</button>
        <button className={`tab ${tab === 'pi-followup' ? 'tab--active' : ''}`} onClick={() => onTabChange('pi-followup')}>PI Follow-up</button>
        <button className={`tab ${tab === 'dso-trends' ? 'tab--active' : ''}`} onClick={() => onTabChange('dso-trends')}>DSO & Trends</button>
      </div>
      {tab === 'receivables' && <ReceivablesScreen navParams={navParams} clearNavParams={clearNavParams} onNavigate={onNavigate} />}
      {tab === 'payables' && <PayablesScreen navParams={navParams} clearNavParams={clearNavParams} />}
      {tab === 'invoice-followup' && <PaymentFollowUpScreen docType="invoice" navParams={navParams} clearNavParams={clearNavParams} />}
      {tab === 'pi-followup' && <PaymentFollowUpScreen docType="pi" navParams={navParams} clearNavParams={clearNavParams} />}
      {tab === 'dso-trends' && <CollectionsTrendScreen />}
    </>
  )
}
