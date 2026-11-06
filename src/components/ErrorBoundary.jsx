import { Component } from 'react';

// Se uma tela der erro, mostra a mensagem em vez de deixar o app inteiro preto.
export default class ErrorBoundary extends Component {
  state = { error: null };
  static getDerivedStateFromError(error) { return { error }; }
  componentDidCatch(error, info) { console.error(error, info?.componentStack); }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="page">
        <div className="error-box" style={{ marginTop: 'calc(var(--safe-t) + 24px)' }}>
          <strong>Esta tela encontrou um erro.</strong>
          <p className="small">{String(this.state.error?.message || this.state.error)}</p>
        </div>
        <div className="hi-actions" style={{ marginTop: 16 }}>
          <button className="xbtn" onClick={() => this.setState({ error: null })}>Tentar de novo</button>
          <button className="xbtn primary" onClick={() => { this.setState({ error: null }); this.props.onBack?.(); }}>Voltar à estante</button>
        </div>
      </div>
    );
  }
}
