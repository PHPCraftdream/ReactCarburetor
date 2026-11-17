// #region doc
interface IActionProps {
    danger: boolean;
    status: 'paid' | 'open';
}

export const Action = ({danger, status}: IActionProps) => (
    <div className="order-status" data-status={status}>
        <button className="submit-button">Save</button>
        <button className={danger ? 'delete-button' : 'submit-button'}>Go</button>
    </div>
);
// #endregion doc
