import React from 'react';
import './iframe-wrapper.scss';

interface IframeWrapperProps {
    src: string;
    title: string;
    className?: string;
}

const IframeWrapper: React.FC<IframeWrapperProps> = ({ src, title, className = '' }) => {
    return (
        <div className={`iframe-wrapper ${className}`}>
            <iframe
                src={src}
                title={title}
                className='iframe-wrapper__frame'
                frameBorder='0'
                allowFullScreen
            />
        </div>
    );
};

export default IframeWrapper;
